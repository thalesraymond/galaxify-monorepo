/**
 * Session-owned bounded observation of downstream effects (`web-frontend.md`
 * §3.2, §3.4). One module owns the lifecycle machinery — the immediate/1/2/4/8
 * active-second schedule, visibility/offline/observer pauses, bounded reads,
 * expiry, and player-initiated retry — while domain adapters own what the
 * expected change means and how fresh facts are published to shared queries.
 *
 * The store lives for the Player session, not for a component: registering an
 * expectation is idempotent by `key`, so a route change pauses reads (there is
 * no visible observer of the affected resource) without resetting the
 * remaining budget, and a return resumes the same round. Session boundaries
 * clear every entry, and any response that settles after its round was
 * superseded, expired, or cleared is discarded before it can publish facts or
 * restore an observation.
 *
 * Observers and phase listeners are different seams: only a visible observer
 * of the affected resource keeps reads running, while a phase listener merely
 * follows the round's phase (a domain adapter rendering what it expects).
 */

export type DownstreamObservationPhase = 'idle' | 'updating' | 'delayed'

export type DownstreamObservation<Facts> = {
  /** Stable identity for one expected change; re-registering resumes it. */
  readonly key: string
  /**
   * Fresh read; resolves only with facts from a successful read (never with
   * retained cache data after a failed refresh) and rejects on any failure.
   */
  readonly read: (signal: AbortSignal) => Promise<Facts>
  /** True when the fresh facts satisfy the expected change. */
  readonly isSatisfied: (facts: Facts) => boolean
  /** Publishes fresh facts to the shared queries the app renders from. */
  readonly publish: (facts: Facts) => void
}

/** Scheduler granularity for active-time accounting; small so pauses resume precisely. */
const OBSERVATION_STEP_MS = 100

/**
 * §3.4: reconcile immediately and after approximately 1, 2, 4, and 8 active
 * seconds. "Active" excludes hidden, offline, and unobserved time, so a paused
 * round resumes its remaining budget. Slow reads consume the budget, which
 * skips the marks they run past instead of firing a catch-up burst.
 */
const OBSERVATION_MARKS_MS = [0, 1_000, 2_000, 4_000, 8_000] as const

/** While paused, re-check cadence: cheap, and never issues a read. */
const OBSERVATION_PAUSED_STEP_MS = 250

/**
 * A read that has not settled is aborted and treated as a failed attempt after
 * this, so a hanging request can never keep an observation Updating forever.
 */
const OBSERVATION_READ_TIMEOUT_MS = 5_000

type ReadOutcome =
  { readonly ok: true; readonly facts: unknown } | { readonly ok: false; readonly timedOut?: true }

type ObservationEntry = {
  readonly key: string
  readonly read: (signal: AbortSignal) => Promise<unknown>
  readonly isSatisfied: (facts: unknown) => boolean
  readonly publish: (facts: unknown) => void
  phase: DownstreamObservationPhase
  /** Round token: late responses from a superseded round are discarded. */
  round: number
  /** Active milliseconds accumulated in this round (pauses do not accrue). */
  elapsedMs: number
  /** Next schedule mark to read at; past marks are skipped, never caught up. */
  nextMarkIndex: number
  reading: boolean
  timer: number | undefined
  readTimer: number | undefined
  controller: AbortController | undefined
}

export class DownstreamReconciliation {
  public sessionGeneration = 0
  private readonly entries = new Map<string, ObservationEntry>()
  /**
   * Visible observers live outside the rounds: a session clear retires every
   * entry, but a still-mounted view stays subscribed, so a later observation
   * with the same identity restarts and is notified normally.
   */
  private readonly listeners = new Map<string, Set<() => void>>()
  /**
   * Phase listeners follow a round's phase without observing the affected
   * resource. They learn that a round started, expired, or settled, but they
   * never count as a visible observer and never wake a paused round.
   */
  private readonly phaseListeners = new Map<string, Set<() => void>>()
  /**
   * Session-cleanup hooks for domain adapters that keep side state beside the
   * module's rounds (their own expectation records). A session boundary clears
   * both, so the adapter never keeps expectations for a retired round.
   */
  private readonly clearListeners = new Set<() => void>()

  /**
   * Registers the expected change. Registering an already-known pending `key`
   * resumes the round unchanged (no budget reset), so callers may register from
   * every mount without disturbing navigation survival. A completed round is
   * retired, so the same identity starts a fresh round if the expected change
   * is missing again.
   */
  public register<Facts>(request: DownstreamObservation<Facts>): void {
    if (this.entries.has(request.key)) {
      return
    }
    const entry: ObservationEntry = {
      key: request.key,
      read: (signal) => request.read(signal),
      isSatisfied: (facts) => request.isSatisfied(facts as Facts),
      publish: (facts) => {
        request.publish(facts as Facts)
      },
      phase: 'updating',
      round: 1,
      elapsedMs: 0,
      nextMarkIndex: 0,
      reading: false,
      timer: undefined,
      readTimer: undefined,
      controller: undefined,
    }
    this.entries.set(entry.key, entry)
    this.notify(entry)
    this.pump(entry)
  }

  /**
   * Subscribes a visible observer of the affected resource. Reads pause while
   * no observer is subscribed; unsubscribing never resets the round.
   */
  public subscribe(key: string, listener: () => void): () => void {
    const observers = this.listeners.get(key) ?? new Set<() => void>()
    observers.add(listener)
    this.listeners.set(key, observers)
    const entry = this.entries.get(key)
    if (entry !== undefined) {
      this.wake(entry)
    }
    let subscribed = true
    return () => {
      if (!subscribed) {
        return
      }
      subscribed = false
      const current = this.listeners.get(key)
      current?.delete(listener)
      if (current !== undefined && current.size === 0) {
        this.listeners.delete(key)
        const active = this.entries.get(key)
        if (active !== undefined) {
          this.cancelTimer(active)
        }
      }
    }
  }

  /**
   * Subscribes to a round's phase changes without observing the affected
   * resource. A phase listener never counts as a visible observer: reads stay
   * paused while only phase listeners are registered, and the round resumes
   * with its remaining budget when a visible observer appears. It never wakes
   * a paused round on its own.
   */
  public subscribeToPhase(key: string, listener: () => void): () => void {
    const listeners = this.phaseListeners.get(key) ?? new Set<() => void>()
    listeners.add(listener)
    this.phaseListeners.set(key, listeners)
    let subscribed = true
    return () => {
      if (!subscribed) {
        return
      }
      subscribed = false
      const current = this.phaseListeners.get(key)
      current?.delete(listener)
      if (current !== undefined && current.size === 0) {
        this.phaseListeners.delete(key)
      }
    }
  }

  public getPhase(key: string): DownstreamObservationPhase {
    return this.entries.get(key)?.phase ?? 'idle'
  }

  /**
   * Player-initiated Retry: starts another bounded budget for the same
   * expected change, preserving its identity and expectation.
   */
  public retry(key: string): void {
    const entry = this.entries.get(key)
    if (entry === undefined) {
      return
    }
    this.cancelWork(entry)
    entry.round += 1
    entry.elapsedMs = 0
    entry.nextMarkIndex = 0
    entry.phase = 'updating'
    this.notify(entry)
    this.pump(entry)
  }

  /**
   * Registers a session-cleanup hook. The listener runs inside `clear()` (and
   * therefore `dispose()`), so domain adapters can drop the side state they
   * keep beside the module's rounds. The returned function detaches it.
   */
  public onClear(listener: () => void): () => void {
    this.clearListeners.add(listener)
    return () => {
      this.clearListeners.delete(listener)
    }
  }

  /**
   * Session boundary: cancels every pending round and aborts in-flight reads.
   * A response that settles afterwards cannot publish or restore anything.
   */
  public clear(): void {
    this.sessionGeneration += 1
    // Domain side state goes first: a retired round must not read as a
    // settled expectation to an adapter that is still subscribed to it.
    this.notifyClear()
    for (const entry of this.entries.values()) {
      this.cancelWork(entry)
      entry.round += 1
      entry.phase = 'idle'
      this.notify(entry)
    }
    this.entries.clear()
  }

  /** App-level disposal: clears pending work and observer bookkeeping. */
  public dispose(): void {
    this.clear()
    this.listeners.clear()
    this.phaseListeners.clear()
  }

  private pump(entry: ObservationEntry): void {
    const round = entry.round
    if (!this.isCurrent(entry, round) || entry.phase !== 'updating') {
      return
    }
    if (entry.reading) {
      this.scheduleTick(entry)
      return
    }
    const mark = OBSERVATION_MARKS_MS[entry.nextMarkIndex]
    if (mark === undefined) {
      this.expire(entry)
      return
    }
    if (!this.isPaused(entry) && entry.elapsedMs >= mark) {
      void this.readOnce(entry, round)
      this.scheduleTick(entry)
      return
    }
    this.scheduleTick(entry)
  }

  private tick(entry: ObservationEntry, elapsedMs: number): void {
    const round = entry.round
    if (!this.isCurrent(entry, round)) {
      return
    }
    if (!this.isPaused(entry)) {
      entry.elapsedMs += elapsedMs
    }
    this.pump(entry)
  }

  private async readOnce(entry: ObservationEntry, round: number): Promise<void> {
    const controller = new AbortController()
    entry.reading = true
    entry.controller = controller
    const outcome = await this.boundedRead(entry, controller)
    if (!this.isCurrent(entry, round)) {
      return
    }
    entry.reading = false
    entry.controller = undefined
    if (!outcome.ok && outcome.timedOut) {
      // Cancellation may not settle the underlying read promptly; never start
      // another automatic attempt alongside it. Retry is Player-initiated.
      this.expire(entry)
      return
    }
    if (outcome.ok) {
      entry.publish(outcome.facts)
      if (entry.isSatisfied(outcome.facts)) {
        this.cancelTimer(entry)
        entry.phase = 'idle'
        this.notify(entry)
        // Retire the completed round: the expectation is observed, and a later
        // missing observation with the same identity starts fresh.
        this.entries.delete(entry.key)
        return
      }
    }
    const nextIndex = OBSERVATION_MARKS_MS.findIndex((mark) => mark > entry.elapsedMs)
    if (nextIndex === -1) {
      this.expire(entry)
      return
    }
    entry.nextMarkIndex = nextIndex
  }

  private boundedRead(entry: ObservationEntry, controller: AbortController): Promise<ReadOutcome> {
    return new Promise((resolve) => {
      let settled = false
      let timer: number | undefined
      const settle = (outcome: ReadOutcome): void => {
        if (settled) {
          return
        }
        settled = true
        // Only clear the entry's timeout when it is this attempt's: a retry may
        // already have started the next read with its own bounded timeout.
        if (entry.readTimer === timer) {
          entry.readTimer = undefined
        }
        if (timer !== undefined) {
          window.clearTimeout(timer)
          timer = undefined
        }
        resolve(outcome)
      }
      timer = window.setTimeout(() => {
        controller.abort()
        settle({ ok: false, timedOut: true })
      }, OBSERVATION_READ_TIMEOUT_MS)
      entry.readTimer = timer
      entry.read(controller.signal).then(
        (facts) => {
          settle({ ok: true, facts })
        },
        () => {
          settle({ ok: false })
        },
      )
    })
  }

  private expire(entry: ObservationEntry): void {
    this.cancelTimer(entry)
    entry.phase = 'delayed'
    this.notify(entry)
  }

  private wake(entry: ObservationEntry): void {
    this.cancelTimer(entry)
    this.pump(entry)
  }

  private scheduleTick(entry: ObservationEntry): void {
    if (entry.timer !== undefined) {
      return
    }
    if (!this.hasObserver(entry.key)) {
      // Without a visible observer there is nothing to resume until one
      // subscribes (subscribe wakes the round); this also keeps an unobserved
      // pending round free of timers.
      return
    }
    const delay = this.isPaused(entry) ? OBSERVATION_PAUSED_STEP_MS : OBSERVATION_STEP_MS
    const startedAt = performance.now()
    const wasPaused = this.isPaused(entry)
    entry.timer = window.setTimeout(() => {
      entry.timer = undefined
      this.tick(entry, wasPaused ? 0 : performance.now() - startedAt)
    }, delay)
  }

  private cancelTimer(entry: ObservationEntry): void {
    if (entry.timer !== undefined) {
      window.clearTimeout(entry.timer)
      entry.timer = undefined
    }
  }

  private cancelWork(entry: ObservationEntry): void {
    this.cancelTimer(entry)
    if (entry.readTimer !== undefined) {
      window.clearTimeout(entry.readTimer)
      entry.readTimer = undefined
    }
    entry.controller?.abort()
    entry.controller = undefined
    entry.reading = false
  }

  /**
   * A read may not start while the page is hidden, offline, or no visible
   * observer displays the affected resource (§3.2).
   */
  private isPaused(entry: ObservationEntry): boolean {
    if (document.visibilityState !== 'visible' || !navigator.onLine) {
      return true
    }
    return !this.hasObserver(entry.key)
  }

  private hasObserver(key: string): boolean {
    return (this.listeners.get(key)?.size ?? 0) > 0
  }

  private isCurrent(entry: ObservationEntry, round: number): boolean {
    return this.entries.get(entry.key) === entry && entry.round === round
  }

  private notify(entry: ObservationEntry): void {
    this.notifyListeners(this.listeners.get(entry.key))
    this.notifyListeners(this.phaseListeners.get(entry.key))
  }

  private notifyListeners(listeners: Set<() => void> | undefined): void {
    if (listeners === undefined) {
      return
    }
    for (const listener of listeners) {
      listener()
    }
  }

  private notifyClear(): void {
    for (const listener of [...this.clearListeners]) {
      listener()
    }
  }
}

/** The Player-session store shared by the module's public functions and hook. */
export const downstreamReconciliation = new DownstreamReconciliation()

export function getDownstreamSessionGeneration(): number {
  return downstreamReconciliation.sessionGeneration
}

/** Registers an expected change on the session store. */
export function registerDownstreamObservation<Facts>(request: DownstreamObservation<Facts>): void {
  downstreamReconciliation.register(request)
}

/** Reads the phase of an expected change (`idle` when nothing is pending). */
export function downstreamObservationPhase(key: string): DownstreamObservationPhase {
  return downstreamReconciliation.getPhase(key)
}

/**
 * Registers a session-cleanup hook for domain adapters that keep side state
 * beside the module's rounds. The listener runs when pending observations are
 * cleared; the returned function detaches it.
 */
export function onClearDownstreamObservations(listener: () => void): () => void {
  return downstreamReconciliation.onClear(listener)
}

/** Cancels every pending observation at a session boundary (logout, account change). */
export function clearDownstreamObservations(): void {
  downstreamReconciliation.clear()
}

/** Cancels pending work and observer bookkeeping when the app is disposed. */
export function disposeDownstreamReconciliation(): void {
  downstreamReconciliation.dispose()
}
