/**
 * Session-owned bounded observation of downstream effects and Balance Gate
 * (`web-frontend.md` §3.2, §3.4; ADR-0014). One deep module owns the full
 * reconciliation lifecycle — the immediate/1/2/4/8 active-second schedule,
 * visibility/offline/observer pauses, bounded reads, scoped expectation stores,
 * duplicate-registration conflict policies, atomic `publish -> isSatisfied`
 * evaluation, player-session guards, expiry/retry, and the built-in Balance
 * Gate state machine — while domain adapters supply only the domain read,
 * satisfaction predicate, and cache publication.
 */

export type DownstreamObservationPhase = 'idle' | 'updating' | 'delayed'

/** Duplicate-registration conflict policy for a session observation key. */
export type ConflictPolicy = 'resume' | 'once-per-session' | 'replace-when-settled' | 'restart'

export type DownstreamObservation<Facts = unknown, Meta = void> = {
  /** Stable identity for one expected change. */
  readonly key: string
  /** Item identifier inside `scope` (defaults to `key`). */
  readonly id?: string | undefined
  /** Optional scope grouping related expectations (e.g. `'daily:award'`). */
  readonly scope?: string | undefined
  /** Per-key domain metadata owned inside the session store. */
  readonly meta?: Meta | undefined
  /** Policy when `register()` is called for an already-known `key`. */
  readonly onConflict?: ConflictPolicy | undefined
  /** Whether this observation holds balance-spending Ship/Expedition actions. */
  readonly gatesBalance?: boolean | undefined
  /**
   * Fresh read; resolves only with facts from a successful read (never with
   * retained cache data after a failed refresh) and rejects on any failure.
   */
  readonly read: (signal: AbortSignal) => Promise<Facts>
  /** True when the fresh facts satisfy the expected change. */
  readonly isSatisfied: (facts: Facts, meta: Meta) => boolean
  /**
   * Publishes fresh facts to shared queries and optionally returns updated
   * metadata before `isSatisfied` is evaluated.
   */
  readonly publish?:
    | ((facts: Facts, meta: Meta) => Meta | undefined)
    | ((facts: Facts, meta: Meta) => void)
    | undefined
}

/** Scoped expectation snapshot exposed to views via `useDownstreamExpectations`. */
export type DownstreamExpectation<Meta = Record<string, unknown>> = Readonly<Meta> & {
  readonly key: string
  readonly id: string
  readonly phase: DownstreamObservationPhase
}

export type BalanceGateState = 'open' | 'updating' | 'refreshing' | 'stale'

export type BalanceGateInput = {
  readonly read: (signal: AbortSignal) => Promise<boolean>
  readonly confirmedAt: number | undefined
  readonly hasRefreshError?: boolean | undefined
}

export type BalanceGateView = {
  readonly state: BalanceGateState
  readonly retry: () => void
}

export type BalanceGateExpiry = {
  readonly epoch: number | undefined
  readonly generation: number
}

export class DownstreamSessionChangedError extends Error {
  constructor(message = 'Downstream session changed.') {
    super(message)
    this.name = 'DownstreamSessionChangedError'
  }
}

export type SessionGuard = {
  readonly generation: number
  readonly isCurrent: () => boolean
  readonly assertCurrent: (message?: string) => void
  readonly run: <T>(fn: () => T) => T | undefined
}

export type TimerHandle = number

/** Environment seam controlling clocks, timers, and page/network availability. */
export type ReconciliationEnvironment = {
  readonly now: () => number
  readonly wallNow: () => number
  readonly setTimeout: (callback: () => void, ms: number) => TimerHandle
  readonly clearTimeout: (handle: TimerHandle) => void
  readonly isAvailable: () => boolean
  readonly subscribeAvailability: (listener: () => void) => () => void
}

/** Deterministic in-memory environment for fast reconciliation unit tests. */
export type TestReconciliationEnvironment = {
  readonly env: ReconciliationEnvironment
  readonly advance: (ms: number) => Promise<void>
  readonly setAvailable: (available: boolean) => void
  readonly pendingTimers: () => number
}

type PendingTestTimer = {
  readonly id: number
  readonly at: number
  readonly callback: () => void
}

async function flushTestMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve()
  }
}

/** Builds an in-memory clock/timer/availability controller for unit tests. */
export function createTestReconciliationEnvironment(initial?: {
  readonly now?: number
  readonly wallNow?: number
  readonly available?: boolean
}): TestReconciliationEnvironment {
  let currentNow = initial?.now ?? 0
  let currentWallNow = initial?.wallNow ?? initial?.now ?? 0
  let available = initial?.available ?? true
  let nextTimerId = 1
  const timers = new Map<number, PendingTestTimer>()
  const listeners = new Set<() => void>()

  const env: ReconciliationEnvironment = {
    now: () => currentNow,
    wallNow: () => currentWallNow,
    setTimeout: (callback, ms) => {
      const id = nextTimerId
      nextTimerId += 1
      timers.set(id, { id, at: currentNow + Math.max(0, ms), callback })
      return id
    },
    clearTimeout: (handle) => {
      timers.delete(handle)
    },
    isAvailable: () => available,
    subscribeAvailability: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }

  return {
    env,
    advance: async (ms) => {
      const target = currentNow + Math.max(0, ms)
      await flushTestMicrotasks()
      for (;;) {
        let earliest: PendingTestTimer | undefined
        for (const entry of timers.values()) {
          if (
            entry.at <= target &&
            (earliest === undefined ||
              entry.at < earliest.at ||
              (entry.at === earliest.at && entry.id < earliest.id))
          ) {
            earliest = entry
          }
        }
        if (earliest === undefined) {
          break
        }
        timers.delete(earliest.id)
        const delta = earliest.at - currentNow
        currentNow = earliest.at
        currentWallNow += delta
        earliest.callback()
        await flushTestMicrotasks()
      }
      if (target > currentNow) {
        const delta = target - currentNow
        currentNow = target
        currentWallNow += delta
      }
      await flushTestMicrotasks()
    },
    setAvailable: (nextAvailable) => {
      if (available === nextAvailable) {
        return
      }
      available = nextAvailable
      for (const listener of [...listeners]) {
        listener()
      }
    },
    pendingTimers: () => timers.size,
  }
}

/**
 * Default browser adapter. Looks up clocks, timers, and DOM availability
 * dynamically on every call so Vitest fake timers and property spies on
 * `performance`, `Date`, `document.visibilityState`, and `navigator.onLine`
 * work transparently on the shared singleton.
 */
export const browserReconciliationEnvironment: ReconciliationEnvironment = {
  now: () => performance.now(),
  wallNow: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    window.clearTimeout(handle)
  },
  isAvailable: () =>
    (typeof document === 'undefined' || document.visibilityState === 'visible') &&
    (typeof navigator === 'undefined' || navigator.onLine),
  subscribeAvailability: (listener) => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return () => {}
    }
    document.addEventListener('visibilitychange', listener)
    window.addEventListener('online', listener)
    window.addEventListener('offline', listener)
    return () => {
      document.removeEventListener('visibilitychange', listener)
      window.removeEventListener('online', listener)
      window.removeEventListener('offline', listener)
    }
  },
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

/** Bounds hanging observation and balance-gate verification reads. */
const OBSERVATION_READ_TIMEOUT_MS = 5_000

const EMPTY_EXPECTATIONS: ReadonlyMap<string, DownstreamExpectation> = new Map()

type ReadOutcome =
  { readonly ok: true; readonly facts: unknown } | { readonly ok: false; readonly timedOut?: true }

type ObservationEntry = {
  readonly key: string
  id: string
  scope: string | undefined
  meta: unknown
  onConflict: ConflictPolicy
  gatesBalance: boolean
  read: (signal: AbortSignal) => Promise<unknown>
  isSatisfied: (facts: unknown, meta: unknown) => boolean
  publish: ((facts: unknown, meta: unknown) => unknown) | undefined
  phase: DownstreamObservationPhase
  /** Round token: late responses from a superseded round are discarded. */
  round: number
  /** Active milliseconds accumulated in this round (pauses do not accrue). */
  elapsedMs: number
  /** Next schedule mark to read at; past marks are skipped, never caught up. */
  nextMarkIndex: number
  reading: boolean
  timer: TimerHandle | undefined
  readTimer: TimerHandle | undefined
  controller: AbortController | undefined
}

function buildExpectationSnapshot(entry: ObservationEntry): DownstreamExpectation {
  const baseMeta =
    typeof entry.meta === 'object' && entry.meta !== null
      ? (entry.meta as Record<string, unknown>)
      : {}
  return Object.freeze({
    ...baseMeta,
    key: entry.key,
    id: entry.id,
    phase: entry.phase,
  })
}

export class DownstreamReconciliation {
  private readonly env: ReconciliationEnvironment
  private generation = 0
  private stopAvailability: (() => void) | undefined

  private readonly entries = new Map<string, ObservationEntry>()
  private readonly sessionSeenKeys = new Set<string>()
  private readonly listeners = new Map<string, Set<() => void>>()
  private readonly phaseListeners = new Map<string, Set<() => void>>()
  private readonly clearListeners = new Set<() => void>()

  private readonly scopeSnapshots = new Map<string, ReadonlyMap<string, DownstreamExpectation>>()
  private readonly scopeListeners = new Map<string, Set<() => void>>()

  private readonly balanceGateKeys = new Set<string>()
  private balanceGateKeysSnapshot: readonly string[] = []
  private readonly balanceGateKeyListeners = new Set<() => void>()
  private readonly balanceGateExpiryListeners = new Set<() => void>()
  private readonly balanceGateListeners = new Set<() => void>()
  private gateObserverCount = 0

  private expiryEpoch: number | undefined
  private expiryGeneration = 0
  private expirySnapshotString = '|0'
  private expirySnapshotObj: BalanceGateExpiry = { epoch: undefined, generation: 0 }

  private freshEpoch: number | undefined
  private attemptedGeneration: number | undefined
  private failedGeneration: number | undefined
  private inFlightGateGeneration: number | undefined
  private inFlightGateController: AbortController | undefined
  private inFlightGateTimer: TimerHandle | undefined
  private lastGateInput: BalanceGateInput | undefined

  constructor(env: ReconciliationEnvironment = browserReconciliationEnvironment) {
    this.env = env
  }

  /** Monotonic Player-session id, bumped by every clear(). */
  public get sessionGeneration(): number {
    return this.generation
  }

  /** Captures a guard for verifying that async work still belongs to this session. */
  public captureSession(): SessionGuard {
    const captured = this.generation
    return {
      generation: captured,
      isCurrent: () => this.generation === captured,
      assertCurrent: (message) => {
        if (this.generation !== captured) {
          throw new DownstreamSessionChangedError(message)
        }
      },
      run: <T>(fn: () => T): T | undefined => {
        if (this.generation !== captured) {
          return undefined
        }
        return fn()
      },
    }
  }

  /**
   * Registers an expected downstream change under `request.key`, applying
   * `request.onConflict` (defaults to `'once-per-session'` when `meta` is
   * provided, otherwise `'resume'`) to any existing registration.
   */
  public register<Facts, Meta = void>(request: DownstreamObservation<Facts, Meta>): () => void {
    this.ensureAvailabilitySubscribed()
    const policy =
      request.onConflict ?? (request.meta !== undefined ? 'once-per-session' : 'resume')
    const gatesBalance = request.gatesBalance === true
    const existing = this.entries.get(request.key)

    if (policy === 'once-per-session') {
      if (existing !== undefined || this.sessionSeenKeys.has(request.key)) {
        if (existing !== undefined && existing.phase === 'updating') {
          this.wake(existing)
        }
        return () => {
          this.retire(request.key)
        }
      }
    } else if (policy === 'replace-when-settled' && existing !== undefined) {
      if (existing.phase === 'updating') {
        this.wake(existing)
        return () => {
          this.retire(request.key)
        }
      }
      this.replaceEntry(existing, request, policy, gatesBalance)
      return () => {
        this.retire(request.key)
      }
    } else if (policy === 'resume' && existing !== undefined && existing.phase !== 'idle') {
      this.wake(existing)
      return () => {
        this.retire(request.key)
      }
    }

    if (existing !== undefined) {
      this.replaceEntry(existing, request, policy, gatesBalance)
      return () => {
        this.retire(request.key)
      }
    }

    const entry: ObservationEntry = {
      key: request.key,
      id: request.id ?? request.key,
      scope: request.scope,
      meta: request.meta,
      onConflict: policy,
      gatesBalance,
      ...this.createHandlers(request),
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
    this.sessionSeenKeys.add(entry.key)
    if (entry.gatesBalance) {
      this.addBalanceGateKeyInternal(entry.key)
    }
    if (entry.scope !== undefined) {
      this.rebuildScopeSnapshot(entry.scope)
    }
    this.notify(entry)
    if (entry.scope !== undefined) {
      this.notifyScopeListeners(entry.scope)
    }
    this.notifyBalanceGateListeners()
    this.pump(entry)
    return () => {
      this.retire(request.key)
    }
  }

  /**
   * Subscribes a visible observer of the affected resource. Reads pause while
   * no observer is subscribed; unsubscribing never resets the round.
   */
  public subscribe(key: string, listener: () => void): () => void {
    this.ensureAvailabilitySubscribed()
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
        if (active !== undefined && !this.hasObserver(key)) {
          this.cancelTimer(active)
        }
      }
    }
  }

  /**
   * Subscribes to a round's phase changes without observing the affected
   * resource. A phase listener never counts as a visible observer.
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

  /** Returns a reference-stable map of all expectations in `scope`, keyed by `id`. */
  public getExpectations<Meta = Record<string, unknown>>(
    scope: string,
  ): ReadonlyMap<string, DownstreamExpectation<Meta>> {
    return (this.scopeSnapshots.get(scope) ?? EMPTY_EXPECTATIONS) as ReadonlyMap<
      string,
      DownstreamExpectation<Meta>
    >
  }

  /** Subscribes to additions, metadata updates, and phase transitions within `scope`. */
  public subscribeExpectations(scope: string, listener: () => void): () => void {
    const listeners = this.scopeListeners.get(scope) ?? new Set<() => void>()
    listeners.add(listener)
    this.scopeListeners.set(scope, listeners)
    let subscribed = true
    return () => {
      if (!subscribed) {
        return
      }
      subscribed = false
      const current = this.scopeListeners.get(scope)
      current?.delete(listener)
      if (current !== undefined && current.size === 0) {
        this.scopeListeners.delete(scope)
      }
    }
  }

  /**
   * Player-initiated Retry: starts another bounded budget for an active or
   * delayed observation while preserving its identity and metadata.
   */
  public retry(key: string): void {
    const entry = this.entries.get(key)
    if (entry === undefined || entry.phase === 'idle') {
      return
    }
    this.cancelWork(entry)
    entry.round += 1
    entry.elapsedMs = 0
    entry.nextMarkIndex = 0
    entry.phase = 'updating'
    if (entry.gatesBalance) {
      this.addBalanceGateKeyInternal(entry.key)
    }
    if (entry.scope !== undefined) {
      this.rebuildScopeSnapshot(entry.scope)
    }
    this.notify(entry)
    if (entry.scope !== undefined) {
      this.notifyScopeListeners(entry.scope)
    }
    this.notifyBalanceGateListeners()
    this.pump(entry)
  }

  /** Retires an observation and removes any balance-gate hold for its key. */
  public retire(key: string): void {
    const entry = this.entries.get(key)
    if (entry === undefined) {
      return
    }
    this.cancelWork(entry)
    entry.round += 1
    entry.phase = 'idle'
    this.entries.delete(key)
    if (entry.scope !== undefined) {
      this.rebuildScopeSnapshot(entry.scope)
    }
    this.deleteBalanceGateKeyInternal(key)
    this.notify(entry)
    if (entry.scope !== undefined) {
      this.notifyScopeListeners(entry.scope)
    }
    this.notifyBalanceGateListeners()
  }

  public registerBalanceGateKey(key: string): void {
    this.ensureAvailabilitySubscribed()
    if (this.addBalanceGateKeyInternal(key)) {
      const entry = this.entries.get(key)
      if (entry !== undefined) {
        this.wake(entry)
      }
      this.notifyBalanceGateListeners()
    }
  }

  public unregisterBalanceGateKey(key: string): void {
    if (this.deleteBalanceGateKeyInternal(key)) {
      this.notifyBalanceGateListeners()
    }
  }

  /**
   * Records that a balance-gating observation expired. Every transition into
   * `delayed` advances the monotonic expiry generation so retries cannot reuse
   * approvals from earlier rounds or no-key intervals.
   */
  public markBalanceGateExpired(): void {
    this.recordBalanceGateExpiry()
    this.notifyBalanceGateListeners()
  }

  public subscribeToBalanceGateKeys(listener: () => void): () => void {
    this.balanceGateKeyListeners.add(listener)
    return () => {
      this.balanceGateKeyListeners.delete(listener)
    }
  }

  public getBalanceGateKeys(): readonly string[] {
    return this.balanceGateKeysSnapshot
  }

  public subscribeToBalanceGateExpiry(listener: () => void): () => void {
    this.balanceGateExpiryListeners.add(listener)
    return () => {
      this.balanceGateExpiryListeners.delete(listener)
    }
  }

  public getBalanceGateExpirySnapshot(): string {
    return this.expirySnapshotString
  }

  public getBalanceGateExpiry(): BalanceGateExpiry {
    return this.expirySnapshotObj
  }

  /** Pure derivation of the Balance Gate state from current session and input state. */
  public getBalanceGateState(input: BalanceGateInput): BalanceGateState {
    let hasUpdating = false
    let hasDelayed = false
    for (const key of this.balanceGateKeys) {
      const phase = this.getPhase(key)
      if (phase === 'updating') {
        hasUpdating = true
      } else if (phase === 'delayed') {
        hasDelayed = true
      }
    }
    if (hasUpdating) {
      return 'updating'
    }
    if (!hasDelayed) {
      return 'open'
    }
    const hasRefreshError = input.hasRefreshError === true
    if (hasRefreshError && this.freshEpoch !== undefined) {
      return 'stale'
    }
    const confirmedFresh =
      this.expiryEpoch !== undefined &&
      input.confirmedAt !== undefined &&
      !hasRefreshError &&
      input.confirmedAt > this.expiryEpoch
    const readFresh =
      this.expiryEpoch !== undefined &&
      this.freshEpoch !== undefined &&
      this.freshEpoch > this.expiryEpoch
    if (confirmedFresh || readFresh) {
      return 'open'
    }
    if (this.failedGeneration === this.expiryGeneration) {
      return 'stale'
    }
    return 'refreshing'
  }

  /** Subscribes a mounted Balance Gate consumer (counts as a visible observer). */
  public subscribeBalanceGate(listener: () => void): () => void {
    this.ensureAvailabilitySubscribed()
    this.gateObserverCount += 1
    this.balanceGateListeners.add(listener)
    if (this.gateObserverCount === 1) {
      this.syncActivity()
    }
    let subscribed = true
    return () => {
      if (!subscribed) {
        return
      }
      subscribed = false
      this.balanceGateListeners.delete(listener)
      this.gateObserverCount = Math.max(0, this.gateObserverCount - 1)
      if (this.gateObserverCount === 0) {
        this.syncActivity()
      }
    }
  }

  /** Reconciles the session-owned Balance Gate verification read with `input`. */
  public syncBalanceGate(input: BalanceGateInput): void {
    this.lastGateInput = input
    const hasRefreshError = input.hasRefreshError === true
    const confirmedAt = input.confirmedAt
    if (
      this.expiryEpoch !== undefined &&
      confirmedAt !== undefined &&
      !hasRefreshError &&
      confirmedAt > this.expiryEpoch
    ) {
      const changed =
        this.freshEpoch === undefined ||
        this.freshEpoch < confirmedAt ||
        this.failedGeneration !== undefined
      this.freshEpoch = Math.max(this.freshEpoch ?? 0, confirmedAt)
      this.failedGeneration = undefined
      this.abortInFlightGateRead(false)
      if (changed) {
        this.notifyBalanceGateListeners()
      }
      return
    }

    const state = this.getBalanceGateState(input)
    if (state === 'open') {
      this.abortInFlightGateRead(false)
      return
    }
    if (!this.env.isAvailable()) {
      this.abortInFlightGateRead(true)
      return
    }
    if (
      state === 'refreshing' &&
      this.expiryEpoch !== undefined &&
      this.expiryGeneration > 0 &&
      this.attemptedGeneration !== this.expiryGeneration
    ) {
      this.runGateRead(this.expiryGeneration, input.read)
    }
  }

  /** Player-initiated retry for a stale Balance Gate verification read. */
  public retryBalanceGate(read?: (signal: AbortSignal) => Promise<boolean>): void {
    this.abortInFlightGateRead(false)
    this.freshEpoch = undefined
    this.attemptedGeneration = undefined
    this.failedGeneration = undefined
    const effectiveRead = read ?? this.lastGateInput?.read
    if (effectiveRead !== undefined && this.lastGateInput !== undefined) {
      this.lastGateInput = { ...this.lastGateInput, read: effectiveRead }
    }
    this.notifyBalanceGateListeners()
    if (
      effectiveRead !== undefined &&
      this.env.isAvailable() &&
      this.expiryEpoch !== undefined &&
      this.expiryGeneration > 0 &&
      this.hasDelayedBalanceGateKey() &&
      !this.hasUpdatingBalanceGateKey()
    ) {
      this.runGateRead(this.expiryGeneration, effectiveRead)
    }
  }

  /**
   * Registers a session-cleanup hook. The listener runs inside `clear()` (and
   * therefore `dispose()`).
   */
  public onClear(listener: () => void): () => void {
    this.clearListeners.add(listener)
    return () => {
      this.clearListeners.delete(listener)
    }
  }

  /**
   * Session boundary: cancels every pending round, aborts in-flight reads,
   * clears scoped expectations, and resets Balance Gate holds.
   */
  public clear(): void {
    this.generation += 1
    this.notifyClear()

    this.abortInFlightGateRead(true)
    const hadKeys = this.balanceGateKeys.size > 0
    const hadExpiry = this.expiryEpoch !== undefined || this.expiryGeneration !== 0
    this.balanceGateKeys.clear()
    this.balanceGateKeysSnapshot = []
    this.expiryEpoch = undefined
    this.expiryGeneration = 0
    this.expirySnapshotString = '|0'
    this.expirySnapshotObj = { epoch: undefined, generation: 0 }
    this.freshEpoch = undefined
    this.attemptedGeneration = undefined
    this.failedGeneration = undefined
    this.lastGateInput = undefined

    const affectedScopes = new Set<string>(this.scopeSnapshots.keys())
    for (const entry of this.entries.values()) {
      this.cancelWork(entry)
      entry.round += 1
      entry.phase = 'idle'
      if (entry.scope !== undefined) {
        affectedScopes.add(entry.scope)
      }
      this.notify(entry)
    }
    this.entries.clear()
    this.sessionSeenKeys.clear()
    this.scopeSnapshots.clear()

    for (const scope of affectedScopes) {
      this.notifyScopeListeners(scope)
    }
    if (hadKeys) {
      this.notifyListeners(this.balanceGateKeyListeners)
    }
    if (hadExpiry) {
      this.notifyListeners(this.balanceGateExpiryListeners)
    }
    this.notifyBalanceGateListeners()
  }

  /** App-level disposal: clears pending work and observer bookkeeping. */
  public dispose(): void {
    this.clear()
    this.listeners.clear()
    this.phaseListeners.clear()
    this.scopeListeners.clear()
    this.balanceGateListeners.clear()
    this.balanceGateKeyListeners.clear()
    this.balanceGateExpiryListeners.clear()
    this.gateObserverCount = 0
    this.stopAvailability?.()
    this.stopAvailability = undefined
  }

  private ensureAvailabilitySubscribed(): void {
    if (this.stopAvailability !== undefined) {
      return
    }
    this.stopAvailability = this.env.subscribeAvailability(() => {
      this.syncActivity()
    })
  }

  private createHandlers<Facts, Meta>(
    request: DownstreamObservation<Facts, Meta>,
  ): {
    readonly read: (signal: AbortSignal) => Promise<unknown>
    readonly isSatisfied: (facts: unknown, meta: unknown) => boolean
    readonly publish: ((facts: unknown, meta: unknown) => unknown) | undefined
  } {
    const { read, isSatisfied, publish } = request
    return {
      read: (signal) => read(signal),
      isSatisfied: (facts, meta) =>
        meta === undefined
          ? (isSatisfied as (facts: Facts) => boolean)(facts as Facts)
          : isSatisfied(facts as Facts, meta as Meta),
      publish:
        publish === undefined
          ? undefined
          : (facts, meta) =>
              meta === undefined
                ? (publish as (facts: Facts) => unknown)(facts as Facts)
                : publish(facts as Facts, meta as Meta),
    }
  }

  private replaceEntry<Facts, Meta>(
    existing: ObservationEntry,
    request: DownstreamObservation<Facts, Meta>,
    policy: ConflictPolicy,
    gatesBalance: boolean,
  ): void {
    const previousScope = existing.scope
    this.cancelWork(existing)
    const handlers = this.createHandlers(request)
    existing.id = request.id ?? request.key
    existing.scope = request.scope
    existing.meta = request.meta
    existing.onConflict = policy
    existing.gatesBalance = gatesBalance
    existing.read = handlers.read
    existing.isSatisfied = handlers.isSatisfied
    existing.publish = handlers.publish
    existing.phase = 'updating'
    existing.round += 1
    existing.elapsedMs = 0
    existing.nextMarkIndex = 0
    this.sessionSeenKeys.add(existing.key)
    if (existing.gatesBalance) {
      this.addBalanceGateKeyInternal(existing.key)
    }
    if (previousScope !== undefined && previousScope !== existing.scope) {
      this.rebuildScopeSnapshot(previousScope)
    }
    if (existing.scope !== undefined) {
      this.rebuildScopeSnapshot(existing.scope)
    }
    this.notify(existing)
    if (previousScope !== undefined && previousScope !== existing.scope) {
      this.notifyScopeListeners(previousScope)
    }
    if (existing.scope !== undefined) {
      this.notifyScopeListeners(existing.scope)
    }
    this.notifyBalanceGateListeners()
    this.pump(existing)
  }

  private syncActivity(): void {
    const available = this.env.isAvailable()
    if (!available && this.inFlightGateController !== undefined) {
      this.abortInFlightGateRead(true)
    }

    for (const entry of this.entries.values()) {
      if (entry.phase !== 'updating') {
        continue
      }
      if (this.hasObserver(entry.key)) {
        this.wake(entry)
      } else {
        this.cancelTimer(entry)
      }
    }

    if (available && this.gateObserverCount > 0 && this.lastGateInput !== undefined) {
      this.syncBalanceGate(this.lastGateInput)
    }
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
      let metaChanged = false
      if (entry.publish !== undefined) {
        const nextMeta = entry.publish(outcome.facts, entry.meta)
        if (nextMeta !== undefined) {
          entry.meta = nextMeta
          metaChanged = true
        }
      }
      if (entry.isSatisfied(outcome.facts, entry.meta)) {
        this.completeEntry(entry)
        return
      }
      if (metaChanged && entry.scope !== undefined) {
        this.rebuildScopeSnapshot(entry.scope)
        this.notifyScopeListeners(entry.scope)
      }
    }
    const nextIndex = OBSERVATION_MARKS_MS.findIndex((mark) => mark > entry.elapsedMs)
    if (nextIndex === -1) {
      this.expire(entry)
      return
    }
    entry.nextMarkIndex = nextIndex
  }

  private completeEntry(entry: ObservationEntry): void {
    this.cancelTimer(entry)
    entry.phase = 'idle'
    const retainSettledEntry = entry.scope !== undefined || entry.onConflict === 'once-per-session'
    if (!retainSettledEntry) {
      this.entries.delete(entry.key)
    }
    if (entry.scope !== undefined) {
      this.rebuildScopeSnapshot(entry.scope)
    }
    const gateChanged = this.deleteBalanceGateKeyInternal(entry.key)
    this.notify(entry)
    if (entry.scope !== undefined) {
      this.notifyScopeListeners(entry.scope)
    }
    if (gateChanged || entry.gatesBalance) {
      this.notifyBalanceGateListeners()
    }
  }

  private boundedRead(entry: ObservationEntry, controller: AbortController): Promise<ReadOutcome> {
    return new Promise((resolve) => {
      let settled = false
      let timer: TimerHandle | undefined
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
          this.env.clearTimeout(timer)
          timer = undefined
        }
        resolve(outcome)
      }
      timer = this.env.setTimeout(() => {
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
    if (entry.scope !== undefined) {
      this.rebuildScopeSnapshot(entry.scope)
    }
    const gates = entry.gatesBalance || this.balanceGateKeys.has(entry.key)
    if (gates) {
      this.recordBalanceGateExpiry()
    }
    this.notify(entry)
    if (entry.scope !== undefined) {
      this.notifyScopeListeners(entry.scope)
    }
    this.notifyBalanceGateListeners()
  }

  private wake(entry: ObservationEntry): void {
    this.cancelTimer(entry)
    this.pump(entry)
  }

  private scheduleTick(entry: ObservationEntry): void {
    if (entry.timer !== undefined || !this.hasObserver(entry.key)) {
      return
    }
    const paused = this.isPaused(entry)
    const delay = paused ? OBSERVATION_PAUSED_STEP_MS : OBSERVATION_STEP_MS
    const startedAt = this.env.now()
    entry.timer = this.env.setTimeout(() => {
      entry.timer = undefined
      this.tick(entry, paused ? 0 : this.env.now() - startedAt)
    }, delay)
  }

  private cancelTimer(entry: ObservationEntry): void {
    if (entry.timer !== undefined) {
      this.env.clearTimeout(entry.timer)
      entry.timer = undefined
    }
  }

  private cancelWork(entry: ObservationEntry): void {
    this.cancelTimer(entry)
    if (entry.readTimer !== undefined) {
      this.env.clearTimeout(entry.readTimer)
      entry.readTimer = undefined
    }
    entry.controller?.abort()
    entry.controller = undefined
    entry.reading = false
  }

  private isPaused(entry: ObservationEntry): boolean {
    return !this.env.isAvailable() || !this.hasObserver(entry.key)
  }

  private hasObserver(key: string): boolean {
    if ((this.listeners.get(key)?.size ?? 0) > 0) {
      return true
    }
    return this.gateObserverCount > 0 && this.balanceGateKeys.has(key)
  }

  private isCurrent(entry: ObservationEntry, round: number): boolean {
    return this.entries.get(entry.key) === entry && entry.round === round
  }

  private addBalanceGateKeyInternal(key: string): boolean {
    if (this.balanceGateKeys.has(key)) {
      return false
    }
    this.balanceGateKeys.add(key)
    this.balanceGateKeysSnapshot = [...this.balanceGateKeys]
    this.notifyListeners(this.balanceGateKeyListeners)
    return true
  }

  private deleteBalanceGateKeyInternal(key: string): boolean {
    if (!this.balanceGateKeys.delete(key)) {
      return false
    }
    this.balanceGateKeysSnapshot = [...this.balanceGateKeys]
    if (this.balanceGateKeys.size === 0) {
      // Generations stay monotonic until the session clears: a later expiry
      // must never reuse an approval from an earlier no-key interval.
      this.expiryEpoch = undefined
      this.freshEpoch = undefined
      this.attemptedGeneration = undefined
      this.failedGeneration = undefined
      this.abortInFlightGateRead(false)
      this.expirySnapshotString = `|${this.expiryGeneration}`
      this.expirySnapshotObj = { epoch: undefined, generation: this.expiryGeneration }
      this.notifyListeners(this.balanceGateExpiryListeners)
    }
    this.notifyListeners(this.balanceGateKeyListeners)
    return true
  }

  private recordBalanceGateExpiry(): void {
    this.expiryEpoch = this.env.wallNow()
    this.expiryGeneration += 1
    this.expirySnapshotString = `${this.expiryEpoch}|${this.expiryGeneration}`
    this.expirySnapshotObj = { epoch: this.expiryEpoch, generation: this.expiryGeneration }
    this.freshEpoch = undefined
    this.attemptedGeneration = undefined
    this.failedGeneration = undefined
    this.abortInFlightGateRead(false)
    this.notifyListeners(this.balanceGateExpiryListeners)
  }

  private hasUpdatingBalanceGateKey(): boolean {
    for (const key of this.balanceGateKeys) {
      if (this.getPhase(key) === 'updating') {
        return true
      }
    }
    return false
  }

  private hasDelayedBalanceGateKey(): boolean {
    for (const key of this.balanceGateKeys) {
      if (this.getPhase(key) === 'delayed') {
        return true
      }
    }
    return false
  }

  private abortInFlightGateRead(resetAttempt: boolean): void {
    if (resetAttempt) {
      this.attemptedGeneration = undefined
    }
    if (this.inFlightGateTimer !== undefined) {
      this.env.clearTimeout(this.inFlightGateTimer)
      this.inFlightGateTimer = undefined
    }
    this.inFlightGateGeneration = undefined
    const controller = this.inFlightGateController
    this.inFlightGateController = undefined
    controller?.abort()
  }

  private runGateRead(
    readGeneration: number,
    read: (signal: AbortSignal) => Promise<boolean>,
  ): void {
    const readEpoch = this.expiryEpoch
    if (readEpoch === undefined) {
      return
    }
    this.abortInFlightGateRead(false)
    this.attemptedGeneration = readGeneration
    this.inFlightGateGeneration = readGeneration

    const controller = new AbortController()
    this.inFlightGateController = controller
    const sessionAtStart = this.generation
    let timedOut = false

    const timer = this.env.setTimeout(() => {
      if (
        this.generation !== sessionAtStart ||
        this.inFlightGateGeneration !== readGeneration ||
        this.inFlightGateController !== controller
      ) {
        return
      }
      timedOut = true
      this.inFlightGateTimer = undefined
      this.inFlightGateGeneration = undefined
      this.inFlightGateController = undefined
      controller.abort()
      this.failedGeneration = readGeneration
      this.notifyBalanceGateListeners()
    }, OBSERVATION_READ_TIMEOUT_MS)
    this.inFlightGateTimer = timer

    read(controller.signal).then(
      (ok) => {
        if (this.inFlightGateTimer === timer) {
          this.env.clearTimeout(timer)
          this.inFlightGateTimer = undefined
        }
        if (
          this.generation !== sessionAtStart ||
          this.inFlightGateGeneration !== readGeneration ||
          this.inFlightGateController !== controller ||
          this.expiryGeneration !== readGeneration ||
          this.expiryEpoch === undefined
        ) {
          return
        }
        this.inFlightGateGeneration = undefined
        this.inFlightGateController = undefined
        if (!timedOut && ok) {
          this.freshEpoch = Math.max(this.env.wallNow(), readEpoch + 1)
          this.failedGeneration = undefined
        } else {
          this.failedGeneration = readGeneration
        }
        this.notifyBalanceGateListeners()
      },
      () => {
        if (this.inFlightGateTimer === timer) {
          this.env.clearTimeout(timer)
          this.inFlightGateTimer = undefined
        }
        if (
          this.generation !== sessionAtStart ||
          this.inFlightGateGeneration !== readGeneration ||
          this.inFlightGateController !== controller ||
          this.expiryGeneration !== readGeneration ||
          this.expiryEpoch === undefined
        ) {
          return
        }
        this.inFlightGateGeneration = undefined
        this.inFlightGateController = undefined
        this.failedGeneration = readGeneration
        this.notifyBalanceGateListeners()
      },
    )
  }

  private rebuildScopeSnapshot(scope: string): void {
    const next = new Map<string, DownstreamExpectation>()
    for (const entry of this.entries.values()) {
      if (entry.scope === scope) {
        next.set(entry.id, buildExpectationSnapshot(entry))
      }
    }
    this.scopeSnapshots.set(scope, next)
  }

  private notify(entry: ObservationEntry): void {
    this.notifyListeners(this.listeners.get(entry.key))
    this.notifyListeners(this.phaseListeners.get(entry.key))
  }

  private notifyScopeListeners(scope: string): void {
    this.notifyListeners(this.scopeListeners.get(scope))
  }

  private notifyBalanceGateListeners(): void {
    this.notifyListeners(this.balanceGateListeners)
  }

  private notifyListeners(listeners: Set<() => void> | undefined): void {
    if (listeners === undefined) {
      return
    }
    for (const listener of [...listeners]) {
      listener()
    }
  }

  private notifyClear(): void {
    for (const listener of [...this.clearListeners]) {
      listener()
    }
  }
}

/** The Player-session store shared by the module's public functions and hooks. */
export const downstreamReconciliation = new DownstreamReconciliation()

export function getDownstreamSessionGeneration(): number {
  return downstreamReconciliation.sessionGeneration
}

/** Captures a guard bound to the current Player reconciliation session. */
export function captureDownstreamSession(): SessionGuard {
  return downstreamReconciliation.captureSession()
}

/** Registers an expected change on the session store. */
export function registerDownstreamObservation<Facts, Meta = void>(
  request: DownstreamObservation<Facts, Meta>,
): () => void {
  return downstreamReconciliation.register(request)
}

/** Reads the phase of an expected change (`idle` when nothing is pending). */
export function downstreamObservationPhase(key: string): DownstreamObservationPhase {
  return downstreamReconciliation.getPhase(key)
}

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

export function registerBalanceGateKey(key: string): void {
  downstreamReconciliation.registerBalanceGateKey(key)
}

export function unregisterBalanceGateKey(key: string): void {
  downstreamReconciliation.unregisterBalanceGateKey(key)
}

export function markBalanceGateExpired(): void {
  downstreamReconciliation.markBalanceGateExpired()
}

export function subscribeToBalanceGateKeys(listener: () => void): () => void {
  return downstreamReconciliation.subscribeToBalanceGateKeys(listener)
}

export function getBalanceGateKeys(): readonly string[] {
  return downstreamReconciliation.getBalanceGateKeys()
}

export function subscribeToBalanceGateExpiry(listener: () => void): () => void {
  return downstreamReconciliation.subscribeToBalanceGateExpiry(listener)
}

export function getBalanceGateExpirySnapshot(): string {
  return downstreamReconciliation.getBalanceGateExpirySnapshot()
}

export function getBalanceGateExpiry(): BalanceGateExpiry {
  return downstreamReconciliation.getBalanceGateExpiry()
}
