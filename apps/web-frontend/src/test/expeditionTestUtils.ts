import { act } from '@testing-library/react'
import { vi } from 'vitest'

import { SESSION_REFRESH_STORAGE_KEY } from '@/features/auth'

/**
 * Seeds a real authenticated session through the mock backend, mirroring the
 * Profile journey (login fetch → persisted refresh token) so the app shell
 * bootstraps over MSW exactly like the browser.
 */
export async function seedAuthenticatedSession(): Promise<void> {
  const response = await fetch('/api/user/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'captain@galaxify.test', password: 'password123' }),
  })
  const body = (await response.json()) as { refresh_token: string }
  window.localStorage.setItem(
    SESSION_REFRESH_STORAGE_KEY,
    JSON.stringify({ version: 1, refreshToken: body.refresh_token }),
  )
}

/** Advances Vitest fake timers inside `act`, flushing microtasks as it goes. */
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
