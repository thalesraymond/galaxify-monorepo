import { expect, type Page } from '@playwright/test'

export const SESSION_REFRESH_STORAGE_KEY = 'galaxify.session.refresh.v1'

declare global {
  interface Window {
    __galaxifyMock?: { readonly scenario: string }
  }
}

/** Waits until the MSW worker has started and the mock runtime is reachable. */
export async function waitForMockRuntime(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__galaxifyMock !== undefined)
}

/**
 * Obtains a real, backend-recognized refresh token through the mock login
 * endpoint and seeds the versioned session key, then reloads into the app so
 * bootstrap performs a genuine rotation.
 */
export async function seedAuthenticated(page: Page): Promise<void> {
  await page.goto('/login')
  await waitForMockRuntime(page)
  const result = await page.evaluate(
    async ({ storageKey }) => {
      const response = await fetch('/api/user/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'captain@galaxify.test', password: 'password123' }),
      })
      const text = await response.text()
      if (!response.ok) {
        return { ok: false as const, status: response.status, text }
      }
      const body = JSON.parse(text) as { refresh_token: string }
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ version: 1, refreshToken: body.refresh_token }),
      )
      return { ok: true as const, status: response.status, text: '' }
    },
    { storageKey: SESSION_REFRESH_STORAGE_KEY },
  )
  if (!result.ok) {
    throw new Error(`Failed to seed session: ${result.status} ${result.text}`)
  }
}

export async function expectAuthenticatedDashboard(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
}

/** Asserts the only persisted session material is the opaque refresh token. */
export async function expectOnlyRefreshTokenPersisted(page: Page): Promise<void> {
  const keys = await page.evaluate(() =>
    Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    ),
  )
  const sessionKeys = keys.filter((key) => key === SESSION_REFRESH_STORAGE_KEY)
  expect(sessionKeys).toHaveLength(1)
  const raw = await page.evaluate(({ storageKey }) => window.localStorage.getItem(storageKey), {
    storageKey: SESSION_REFRESH_STORAGE_KEY,
  })
  expect(raw).not.toContain('access_token')
}

export function expectNoTokenInUrl(page: Page): void {
  const url = page.url()
  expect(url).not.toMatch(/token/i)
  expect(url).not.toMatch(/access/i)
}
