import { act } from '@testing-library/react'
import { vi } from 'vitest'

export { seedAuthenticatedSession } from './sessionTestUtils'

/**
 * Advances Vitest fake timers inside `act`, flushing microtasks as it goes.
 * Only valid after `vi.useFakeTimers(...)` has been enabled for the test.
 */
export async function advanceFakeTime(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/**
 * Advances fake timers in small `act`-wrapped steps until `check()` is true.
 * RTL's `waitFor`/`findBy*` do not advance Vitest fake timers (only Jest's),
 * so deterministic tests drive the clock explicitly and use sync queries.
 */
export async function advanceUntil(
  check: () => boolean,
  label: string,
  stepMs = 50,
  maxSteps = 60,
): Promise<void> {
  for (let step = 0; step < maxSteps; step += 1) {
    await advanceFakeTime(stepMs)
    if (check()) {
      return
    }
  }
  throw new Error(`Timed out advancing fake timers while waiting for ${label}.`)
}
