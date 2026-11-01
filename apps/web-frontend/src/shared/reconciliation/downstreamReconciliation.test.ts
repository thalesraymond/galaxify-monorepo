import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DownstreamReconciliation,
  clearDownstreamObservations,
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
