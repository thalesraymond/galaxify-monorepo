import { act } from '@testing-library/react'
import { vi } from 'vitest'

/**
 * Shared deterministic fake-timer helpers for component tests. Vitest's
 * default `vi.useFakeTimers()` also fakes `queueMicrotask`/`nextTick`, which
 * stalls React and promise work, so only the timer and clock primitives the
 * UI actually schedules are faked. RTL's `waitFor`/`findBy*` cannot
 * auto-advance Vitest fake timers, so tests settle with `act`-wrapped
 * advances and synchronous queries.
 */
export function enableFakeTimers(now: number): void {
  vi.useFakeTimers({
    now,
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
}

/** Flushes pending microtasks and React work without advancing fake time. */
export async function settleForeground(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

/** Advances fake time, flushing promise chains and React updates inside act. */
export async function advanceFake(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/**
 * Polls `ready` while settling React work between attempts. Used instead of
 * RTL's `findBy*` under fake timers, which cannot advance them.
 */
export async function waitForUi(ready: () => boolean, attempts = 60): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (ready()) {
      return
    }
    await settleForeground()
  }
  throw new Error('Timed out waiting for the UI under fake timers.')
}
