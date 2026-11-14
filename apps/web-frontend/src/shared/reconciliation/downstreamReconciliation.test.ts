import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DownstreamReconciliation,
  DownstreamSessionChangedError,
  clearDownstreamObservations,
  createTestReconciliationEnvironment,
  getDownstreamSessionGeneration,
} from './downstreamReconciliation'

const KEY = 'test:expected-change'

it('invalidates the session generation on clear', () => {
  const generation = getDownstreamSessionGeneration()
  clearDownstreamObservations()
  expect(getDownstreamSessionGeneration()).toBe(generation + 1)
})

type ReadCall = {
  readonly signal: AbortSignal
  resolve: (facts: string) => void
  reject: (error: Error) => void
}

/**
 * A manually controlled fresh read: every attempt is pending until the test
 * settles it (or aborts it), so slow/error/fresh cases are deterministic.
 */
function createRead(ignoreAbort = false) {
  const calls: ReadCall[] = []
  const read = (signal: AbortSignal): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      calls.push({ signal, resolve, reject })
      signal.addEventListener('abort', () => {
        if (!ignoreAbort) {
          reject(new Error('aborted'))
        }
      })
    })
  return { read, calls }
}

function setVisibility(visible: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (visible ? 'visible' : 'hidden'),
  })
}

function restoreVisibility(): void {
  delete (document as unknown as Record<string, unknown>).visibilityState
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => online,
  })
}

function restoreOnline(): void {
  delete (navigator as unknown as Record<string, unknown>).onLine
}

/** Flushes promise continuations without advancing fake time. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('DownstreamReconciliation', () => {
  let store: DownstreamReconciliation

  beforeEach(() => {
    vi.useFakeTimers()
    store = new DownstreamReconciliation()
    setVisibility(true)
    setOnline(true)
  })

  afterEach(() => {
    store.dispose()
    vi.restoreAllMocks()
    vi.useRealTimers()
    restoreVisibility()
    restoreOnline()
  })

  it('reads immediately and at 1/2/4/8 active seconds, then expires into delayed', async () => {
    const { read, calls } = createRead()
    const publish = vi.fn()
    store.subscribe(KEY, () => {})
    store.register({ key: KEY, read, isSatisfied: () => false, publish })

    expect(store.getPhase(KEY)).toBe('updating')
    expect(calls).toHaveLength(1)

    calls[0]?.reject(new Error('unavailable'))
    await settle()

    const marks = [1_000, 2_000, 4_000, 8_000] as const
    for (const [index, gap] of [1_000, 1_000, 2_000, 4_000].entries()) {
      await vi.advanceTimersByTimeAsync(gap - 1)
      expect(calls).toHaveLength(index + 1)
      await vi.advanceTimersByTimeAsync(1)
      expect(calls).toHaveLength(index + 2)
      calls[index + 1]?.reject(new Error('unavailable'))
      await settle()
    }

    // The 8s attempt settled unsatisfied: the bounded budget is exhausted.
    expect(calls).toHaveLength(marks.length + 1)
    expect(store.getPhase(KEY)).toBe('delayed')
    expect(publish).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(marks.length + 1)
  })

  it('publishes every fresh read and stops the round once satisfied', async () => {
    const { read, calls } = createRead()
    const publish = vi.fn()
    store.subscribe(KEY, () => {})
    store.register({
      key: KEY,
      read,
      isSatisfied: (facts) => facts === 'complete',
      publish,
    })

    calls[0]?.resolve('partial')
    await settle()
    expect(publish).toHaveBeenCalledExactlyOnceWith('partial')
    expect(store.getPhase(KEY)).toBe('updating')

    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toHaveLength(2)
    calls[1]?.resolve('complete')
    await settle()
    expect(publish).toHaveBeenCalledTimes(2)
    expect(store.getPhase(KEY)).toBe('idle')

    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(2)
  })

  it('pauses while hidden without burning the remaining budget and resumes on return', async () => {
    const { read, calls } = createRead()
    store.subscribe(KEY, () => {})
    store.register({ key: KEY, read, isSatisfied: () => false, publish: () => {} })

    calls[0]?.reject(new Error('unavailable'))
    await settle()
    await vi.advanceTimersByTimeAsync(900)

    setVisibility(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toHaveLength(1)
    expect(store.getPhase(KEY)).toBe('updating')

    setVisibility(true)
    await vi.advanceTimersByTimeAsync(250)
    expect(calls).toHaveLength(2)
    calls[1]?.reject(new Error('unavailable'))
    await settle()

    // The next read needs the remaining ~1s of active budget, not a reset.
    await vi.advanceTimersByTimeAsync(500)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(500)
    expect(calls).toHaveLength(3)
  })

  it('pauses while offline', async () => {
    const { read, calls } = createRead()
    store.subscribe(KEY, () => {})
    store.register({ key: KEY, read, isSatisfied: () => false, publish: () => {} })
    calls[0]?.reject(new Error('unavailable'))
    await settle()

    setOnline(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toHaveLength(1)
    expect(store.getPhase(KEY)).toBe('updating')

    setOnline(true)
    await vi.advanceTimersByTimeAsync(1_250)
    expect(calls).toHaveLength(2)
  })

  it('does not start reads while already paused and starts once an observer appears', async () => {
    const { read, calls } = createRead()
    setVisibility(false)
    store.register({ key: KEY, read, isSatisfied: () => false, publish: () => {} })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toHaveLength(0)
    expect(store.getPhase(KEY)).toBe('updating')

    setVisibility(true)
    store.subscribe(KEY, () => {})
    await vi.advanceTimersByTimeAsync(250)
    expect(calls).toHaveLength(1)
  })

  it('pauses while no visible observer subscribes and resumes without resetting', async () => {
    const { read, calls } = createRead()
    store.register({ key: KEY, read, isSatisfied: () => false, publish: () => {} })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toHaveLength(0)

    const unsubscribe = store.subscribe(KEY, () => {})
    expect(calls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(100)
    calls[0]?.reject(new Error('unavailable'))
    await settle()

    unsubscribe()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toHaveLength(1)
    expect(store.getPhase(KEY)).toBe('updating')

    // Resuming needs the remaining ~900ms of the 1s mark, not a fresh budget.
    store.subscribe(KEY, () => {})
    await vi.advanceTimersByTimeAsync(899)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(2)
  })

  it('tells a phase listener about phase changes without making it an observer', async () => {
    const { read, calls } = createRead()
    const phases: string[] = []
    store.subscribeToPhase(KEY, () => {
      phases.push(store.getPhase(KEY))
    })
    store.register({ key: KEY, read, isSatisfied: () => false, publish: () => {} })

    expect(phases).toEqual(['updating'])

    // A phase listener is not a visible observer: the round stays paused.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toHaveLength(0)
    expect(store.getPhase(KEY)).toBe('updating')
    expect(phases).toEqual(['updating'])
  })

  it('pauses a phase-only round and resumes it on a visible observer without resetting', async () => {
    const { read, calls } = createRead()
    const phases: string[] = []
    store.subscribeToPhase(KEY, () => {
      phases.push(store.getPhase(KEY))
    })
    store.register({ key: KEY, read, isSatisfied: () => false, publish: () => {} })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toHaveLength(0)

    store.subscribe(KEY, () => {})
    expect(calls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(100)
    calls[0]?.reject(new Error('unavailable'))
    await settle()

    // The paused time did not burn the budget: the next read needs the
    // remaining ~900ms of the 1s mark, not a fresh one.
    await vi.advanceTimersByTimeAsync(899)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(2)
    expect(phases).toEqual(['updating'])
  })

  it('reports the delayed phase to phase listeners when a round expires', async () => {
    const { read, calls } = createRead()
    const phases: string[] = []
    store.subscribeToPhase(KEY, () => {
      phases.push(store.getPhase(KEY))
    })
    store.subscribe(KEY, () => {})
    store.register({ key: KEY, read, isSatisfied: () => false, publish: () => {} })

    for (const gap of [0, 1_000, 1_000, 2_000, 4_000]) {
      await vi.advanceTimersByTimeAsync(gap)
      calls.at(-1)?.reject(new Error('unavailable'))
      await settle()
    }

    expect(store.getPhase(KEY)).toBe('delayed')
    expect(phases.at(-1)).toBe('delayed')
  })

  it('detaches a phase listener without touching the visible observers', async () => {
    const { read, calls } = createRead()
    const phases: string[] = []
    const detach = store.subscribeToPhase(KEY, () => {
      phases.push(store.getPhase(KEY))
    })
    store.subscribe(KEY, () => {})
    store.register({ key: KEY, read, isSatisfied: () => false, publish: () => {} })

    detach()
    calls[0]?.reject(new Error('unavailable'))
    await settle()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(phases).toEqual(['updating'])
    // The visible observer still drives the round.
    expect(calls).toHaveLength(2)
  })

  it('never overlaps reads and skips marks a slow read runs past instead of catching up', async () => {
    const { read, calls } = createRead()
    store.subscribe(KEY, () => {})
    store.register({ key: KEY, read, isSatisfied: () => false, publish: () => {} })

    // The immediate read is still in flight 3s later: no second read starts.
    await vi.advanceTimersByTimeAsync(3_000)
    expect(calls).toHaveLength(1)

    calls[0]?.resolve('partial')
    await settle()
    // The 1s and 2s marks passed while reading; no catch-up burst.
    expect(calls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(999)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(2)
  })

  it('bounds a hanging read and still expires into delayed', async () => {
    const { read, calls } = createRead(true)
    store.subscribe(KEY, () => {})
    store.register({ key: KEY, read, isSatisfied: () => false, publish: () => {} })

    // A timeout ends the round: an abort-ignoring read cannot overlap another attempt.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.signal.aborted).toBe(true)
    expect(store.getPhase(KEY)).toBe('delayed')

    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(1)
  })

  it('restarts the bounded budget on retry while preserving the expectation', async () => {
    const { read, calls } = createRead()
    const publish = vi.fn()
    store.subscribe(KEY, () => {})
    store.register({ key: KEY, read, isSatisfied: (facts) => facts === 'complete', publish })

    // All five schedule attempts fail: the round expires into delayed.
    for (const gap of [0, 1_000, 1_000, 2_000, 4_000]) {
      await vi.advanceTimersByTimeAsync(gap)
      calls.at(-1)?.reject(new Error('unavailable'))
      await settle()
    }
    expect(calls).toHaveLength(5)
    expect(store.getPhase(KEY)).toBe('delayed')

    store.retry(KEY)
    expect(store.getPhase(KEY)).toBe('updating')
    expect(calls).toHaveLength(6)

    calls[5]?.resolve('complete')
    await settle()
    expect(publish).toHaveBeenCalledExactlyOnceWith('complete')
    expect(store.getPhase(KEY)).toBe('idle')
  })

  it('keeps a pending round across repeated registration without resetting its budget', async () => {
    const { read, calls } = createRead()
    store.subscribe(KEY, () => {})
    store.register({ key: KEY, read, isSatisfied: () => false, publish: () => {} })

    calls[0]?.reject(new Error('unavailable'))
    await settle()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toHaveLength(2)

    store.register({ key: KEY, read, isSatisfied: () => false, publish: () => {} })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(2)

    calls[1]?.reject(new Error('unavailable'))
    await settle()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toHaveLength(3)
  })

  it('discards facts from a read superseded by retry', async () => {
    const { read, calls } = createRead(true)
    const publish = vi.fn()
    store.subscribe(KEY, () => {})
    store.register({ key: KEY, read, isSatisfied: () => true, publish })

    store.retry(KEY)
    expect(calls).toHaveLength(2)

    calls[0]?.resolve('stale')
    await settle()
    expect(publish).not.toHaveBeenCalled()

    calls[1]?.resolve('fresh')
    await settle()
    expect(publish).toHaveBeenCalledExactlyOnceWith('fresh')
    expect(store.getPhase(KEY)).toBe('idle')
  })

  it('bounds the new read when retry supersedes a hanging read', async () => {
    const { read, calls } = createRead()
    store.subscribe(KEY, () => {})
    store.register({ key: KEY, read, isSatisfied: () => false, publish: () => {} })

    store.retry(KEY)
    expect(calls).toHaveLength(2)

    // The superseded read settles (aborted) after the new read started; its
    // settlement must not clear the new read's bounded timeout.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(calls[1]?.signal.aborted).toBe(true)
    expect(store.getPhase(KEY)).toBe('delayed')

    // The bounded schedule still expires into delayed.
    await vi.advanceTimersByTimeAsync(8_500)
    expect(store.getPhase(KEY)).toBe('delayed')
    expect(calls).toHaveLength(2)
  })

  it('accounts for elapsed active time when a visible timer callback runs late', async () => {
    const { read, calls } = createRead()
    store.subscribe(KEY, () => {})
    store.register({ key: KEY, read, isSatisfied: () => false, publish: () => {} })
    calls[0]?.reject(new Error('unavailable'))
    await settle()
    // The browser was busy but stayed visible and online for eight seconds.
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 8_000)
    await vi.advanceTimersByTimeAsync(100)
    expect(calls).toHaveLength(2)
    calls[1]?.reject(new Error('unavailable'))
    await settle()
    expect(store.getPhase(KEY)).toBe('delayed')
    vi.restoreAllMocks()
  })

  it('starts a fresh bounded round when the expected change is missing again', async () => {
    const first = createRead()
    store.subscribe(KEY, () => {})
    store.register({
      key: KEY,
      read: first.read,
      isSatisfied: (facts) => facts === 'complete',
      publish: () => {},
    })
    first.calls[0]?.resolve('complete')
    await settle()
    expect(store.getPhase(KEY)).toBe('idle')

    // The fact regressed to missing (e.g. a lagging read): the same identity
    // starts a new round instead of sticking on a dead observation.
    const second = createRead()
    store.register({
      key: KEY,
      read: second.read,
      isSatisfied: (facts) => facts === 'complete',
      publish: () => {},
    })
    expect(store.getPhase(KEY)).toBe('updating')
    expect(second.calls).toHaveLength(1)

    second.calls[0]?.reject(new Error('unavailable'))
    await settle()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(second.calls).toHaveLength(2)
  })

  it('clears pending work at a session boundary and discards late facts', async () => {
    const { read, calls } = createRead(true)
    const publish = vi.fn()
    store.subscribe(KEY, () => {})
    store.register({ key: KEY, read, isSatisfied: () => true, publish })

    store.clear()
    expect(store.getPhase(KEY)).toBe('idle')
    expect(calls[0]?.signal.aborted).toBe(true)

    calls[0]?.resolve('protected')
    await settle()
    expect(publish).not.toHaveBeenCalled()
    expect(store.getPhase(KEY)).toBe('idle')

    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(1)
  })

  it('keeps a mounted observer across a session clear so a later round resumes', async () => {
    const first = createRead()
    const notifications = vi.fn()
    store.subscribe(KEY, notifications)
    store.register({ key: KEY, read: first.read, isSatisfied: () => false, publish: () => {} })
    expect(first.calls).toHaveLength(1)

    store.clear()
    expect(first.calls[0]?.signal.aborted).toBe(true)
    notifications.mockClear()

    // The view is still mounted: its subscription survives the clear, so a
    // later observation is counted and its phase changes reach the observer.
    const second = createRead()
    store.register({ key: KEY, read: second.read, isSatisfied: () => false, publish: () => {} })
    expect(store.getPhase(KEY)).toBe('updating')
    expect(notifications).toHaveBeenCalled()
    expect(second.calls).toHaveLength(1)

    second.calls[0]?.reject(new Error('unavailable'))
    await settle()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(second.calls).toHaveLength(2)
  })

  it('runs session-cleanup hooks so domain side state is dropped with the rounds', () => {
    const { read, calls } = createRead()
    const cleanup = vi.fn()
    store.onClear(cleanup)
    store.subscribe(KEY, () => {})
    store.register({ key: KEY, read, isSatisfied: () => false, publish: () => {} })

    store.clear()

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(store.getPhase(KEY)).toBe('idle')
    expect(calls[0]?.signal.aborted).toBe(true)
  })

  it('detaches a session-cleanup hook when its adapter releases it', () => {
    const cleanup = vi.fn()
    const detach = store.onClear(cleanup)

    detach()
    store.clear()

    expect(cleanup).not.toHaveBeenCalled()
  })
})

describe('DownstreamReconciliation deepened capabilities', () => {
  it('runs the bounded 1/2/4/8s schedule and availability pause/resume on a test environment without fake timers', async () => {
    const testEnv = createTestReconciliationEnvironment({ now: 1_000, wallNow: 50_000 })
    const store = new DownstreamReconciliation(testEnv.env)
    try {
      const { read, calls } = createRead()
      store.subscribe(KEY, () => {})
      store.register({ key: KEY, read, isSatisfied: () => false, publish: () => {} })

      expect(calls).toHaveLength(1)
      calls[0]?.resolve('still-stale')
      await testEnv.advance(0)
      expect(testEnv.pendingTimers()).toBe(1)

      await testEnv.advance(999)
      expect(calls).toHaveLength(1)
      await testEnv.advance(1)
      expect(calls).toHaveLength(2)
      calls[1]?.resolve('still-stale')
      await testEnv.advance(0)

      // Pause availability: active elapsed budget freezes until available again.
      testEnv.setAvailable(false)
      await testEnv.advance(60_000)
      expect(calls).toHaveLength(2)
      expect(store.getPhase(KEY)).toBe('updating')

      testEnv.setAvailable(true)
      await testEnv.advance(999)
      expect(calls).toHaveLength(2)
      await testEnv.advance(1)
      expect(calls).toHaveLength(3)
      calls[2]?.resolve('still-stale')
      await testEnv.advance(0)
      await testEnv.advance(2_000)
      expect(calls).toHaveLength(4)
      calls[3]?.resolve('still-stale')
      await testEnv.advance(0)
      await testEnv.advance(4_000)
      expect(calls).toHaveLength(5)
      calls[4]?.resolve('still-stale')
      await testEnv.advance(0)
      expect(store.getPhase(KEY)).toBe('delayed')
    } finally {
      store.dispose()
    }
  })

  it('evaluates atomic publish -> isSatisfied with updated metadata and retains settled scoped expectations', async () => {
    type AwardMeta = {
      readonly baseline: number
      readonly observed: number | undefined
      readonly expectedDelta: number
    }
    const testEnv = createTestReconciliationEnvironment()
    const store = new DownstreamReconciliation(testEnv.env)
    const scopeListener = vi.fn()
    try {
      store.subscribeExpectations('daily:award', scopeListener)
      store.subscribe('daily:d1:award', () => {})

      let factsToReturn = 15
      store.register<number, AwardMeta>({
        key: 'daily:d1:award',
        id: 'd1',
        scope: 'daily:award',
        meta: { baseline: 10, observed: undefined, expectedDelta: 10 },
        read: () => Promise.resolve(factsToReturn),
        publish: (facts, meta) => ({ ...meta, observed: facts }),
        isSatisfied: (_facts, meta) =>
          meta.observed !== undefined && meta.observed - meta.baseline >= meta.expectedDelta,
      })

      await testEnv.advance(0)
      const midSnapshot = store.getExpectations<AwardMeta>('daily:award').get('d1')
      expect(midSnapshot).toEqual({
        key: 'daily:d1:award',
        id: 'd1',
        phase: 'updating',
        baseline: 10,
        observed: 15,
        expectedDelta: 10,
      })

      factsToReturn = 22
      await testEnv.advance(1_000)
      const doneSnapshot = store.getExpectations<AwardMeta>('daily:award').get('d1')
      expect(doneSnapshot).toEqual({
        key: 'daily:d1:award',
        id: 'd1',
        phase: 'idle',
        baseline: 10,
        observed: 22,
        expectedDelta: 10,
      })
      expect(scopeListener).toHaveBeenCalled()

      store.clear()
      expect(store.getExpectations<AwardMeta>('daily:award').size).toBe(0)
    } finally {
      store.dispose()
    }
  })

  it('enforces once-per-session, replace-when-settled, and restart conflict policies', async () => {
    type CountMeta = { readonly target: number }
    const testEnv = createTestReconciliationEnvironment()
    const store = new DownstreamReconciliation(testEnv.env)
    try {
      store.subscribe('once', () => {})
      store.subscribe('replace', () => {})
      store.subscribe('restart', () => {})

      const onceRead = createRead()
      store.register<string, CountMeta>({
        key: 'once',
        scope: 'test:once',
        onConflict: 'once-per-session',
        meta: { target: 1 },
        read: onceRead.read,
        isSatisfied: (facts) => facts === 'ok',
      })
      onceRead.calls[0]?.resolve('ok')
      await testEnv.advance(0)
      expect(store.getPhase('once')).toBe('idle')

      // Even after settling, once-per-session refuses duplicate registrations in the same session.
      const duplicateOnce = createRead()
      store.register<string, CountMeta>({
        key: 'once',
        scope: 'test:once',
        onConflict: 'once-per-session',
        meta: { target: 99 },
        read: duplicateOnce.read,
        isSatisfied: () => false,
      })
      expect(duplicateOnce.calls).toHaveLength(0)
      expect(store.getExpectations<CountMeta>('test:once').get('once')?.target).toBe(1)

      // replace-when-settled ignores while updating, then replaces once settled/delayed.
      const replaceFirst = createRead()
      store.register<string, CountMeta>({
        key: 'replace',
        scope: 'test:replace',
        onConflict: 'replace-when-settled',
        meta: { target: 10 },
        read: replaceFirst.read,
        isSatisfied: () => true,
      })
      const replaceWhileUpdating = createRead()
      store.register<string, CountMeta>({
        key: 'replace',
        scope: 'test:replace',
        onConflict: 'replace-when-settled',
        meta: { target: 20 },
        read: replaceWhileUpdating.read,
        isSatisfied: () => false,
      })
      expect(replaceWhileUpdating.calls).toHaveLength(0)

      replaceFirst.calls[0]?.resolve('done')
      await testEnv.advance(0)
      expect(store.getPhase('replace')).toBe('idle')

      const replaceAfterSettle = createRead()
      store.register<string, CountMeta>({
        key: 'replace',
        scope: 'test:replace',
        onConflict: 'replace-when-settled',
        meta: { target: 30 },
        read: replaceAfterSettle.read,
        isSatisfied: () => false,
      })
      expect(replaceAfterSettle.calls).toHaveLength(1)
      expect(store.getPhase('replace')).toBe('updating')
      expect(store.getExpectations<CountMeta>('test:replace').get('replace')?.target).toBe(30)

      // restart immediately cancels the active round and starts a fresh one.
      const restartFirst = createRead()
      store.register({
        key: 'restart',
        onConflict: 'restart',
        read: restartFirst.read,
        isSatisfied: () => false,
      })
      expect(restartFirst.calls).toHaveLength(1)

      const restartSecond = createRead()
      store.register({
        key: 'restart',
        onConflict: 'restart',
        read: restartSecond.read,
        isSatisfied: () => false,
      })
      expect(restartFirst.calls[0]?.signal.aborted).toBe(true)
      expect(restartSecond.calls).toHaveLength(1)
    } finally {
      store.dispose()
    }
  })

  it('drives the built-in Balance Gate through updating -> refreshing -> stale/open including 5s timeout and availability pause', async () => {
    const testEnv = createTestReconciliationEnvironment({ now: 0, wallNow: 1_000 })
    const store = new DownstreamReconciliation(testEnv.env)
    const gateReads: Array<{
      readonly signal: AbortSignal
      resolve: (ok: boolean) => void
      reject: (error: Error) => void
    }> = []
    const gateRead = (signal: AbortSignal): Promise<boolean> =>
      new Promise<boolean>((resolve, reject) => {
        gateReads.push({ signal, resolve, reject })
        signal.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })

    try {
      const gateListener = vi.fn()
      const unsubscribeGate = store.subscribeBalanceGate(gateListener)
      const roundRead = createRead()
      store.register({
        key: 'daily:g1:award',
        gatesBalance: true,
        read: roundRead.read,
        isSatisfied: () => false,
      })

      const gateInput = { read: gateRead, confirmedAt: undefined, hasRefreshError: false }
      expect(store.getBalanceGateState(gateInput)).toBe('updating')
      expect(roundRead.calls).toHaveLength(1)

      // Drive the observation to delayed expiry (marks at 0, 1s, 2s, 4s, 8s active).
      roundRead.calls[0]?.reject(new Error('pending'))
      await testEnv.advance(0)
      await testEnv.advance(1_000)
      roundRead.calls[1]?.reject(new Error('pending'))
      await testEnv.advance(0)
      await testEnv.advance(1_000)
      roundRead.calls[2]?.reject(new Error('pending'))
      await testEnv.advance(0)
      await testEnv.advance(2_000)
      roundRead.calls[3]?.reject(new Error('pending'))
      await testEnv.advance(0)
      await testEnv.advance(4_000)
      roundRead.calls[4]?.reject(new Error('pending'))
      await testEnv.advance(0)
      expect(store.getPhase('daily:g1:award')).toBe('delayed')
      expect(store.getBalanceGateState(gateInput)).toBe('refreshing')

      // Sync starts the gate verification read and bounds it to 5s.
      store.syncBalanceGate(gateInput)
      expect(gateReads).toHaveLength(1)

      await testEnv.advance(5_000)
      expect(gateReads[0]?.signal.aborted).toBe(true)
      expect(store.getBalanceGateState(gateInput)).toBe('stale')

      // Player retries the gate verification read while keeping daily:g1:award delayed.
      store.retryBalanceGate(gateRead)
      expect(store.getPhase('daily:g1:award')).toBe('delayed')
      expect(store.getBalanceGateState(gateInput)).toBe('refreshing')
      expect(gateReads).toHaveLength(2)

      // Going unavailable aborts the in-flight verification read and retries cleanly on return.
      testEnv.setAvailable(false)
      expect(gateReads[1]?.signal.aborted).toBe(true)
      testEnv.setAvailable(true)
      store.syncBalanceGate(gateInput)
      expect(gateReads).toHaveLength(3)

      // Settling the verification read with true opens the gate; a later confirmedAt also opens it.
      gateReads[2]?.resolve(true)
      await testEnv.advance(0)
      expect(store.getBalanceGateState(gateInput)).toBe('open')
      expect(
        store.getBalanceGateState({
          read: gateRead,
          confirmedAt: 2_000,
          hasRefreshError: false,
        }),
      ).toBe('open')

      unsubscribeGate()
    } finally {
      store.dispose()
    }
  })

  it('guards session-scoped callbacks with SessionGuard isCurrent, run, and assertCurrent', () => {
    const testEnv = createTestReconciliationEnvironment()
    const store = new DownstreamReconciliation(testEnv.env)
    try {
      const session = store.captureSession()
      expect(session.isCurrent()).toBe(true)
      expect(() => {
        session.assertCurrent()
      }).not.toThrow()
      expect(session.run(() => 42)).toBe(42)

      store.clear()
      const effect = vi.fn(() => 'should-not-run')
      expect(session.isCurrent()).toBe(false)
      expect(session.run(effect)).toBeUndefined()
      expect(effect).not.toHaveBeenCalled()
      expect(() => {
        session.assertCurrent('Custom session guard error.')
      }).toThrow(DownstreamSessionChangedError)
      expect(() => {
        session.assertCurrent('Custom session guard error.')
      }).toThrow('Custom session guard error.')
    } finally {
      store.dispose()
    }
  })
})
