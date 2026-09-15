import { expect, test } from '@playwright/test'

import { SESSION_REFRESH_STORAGE_KEY } from './session'

/**
 * Runs against a `service-outage` mock server. The refresh token is seeded
 * directly (login is unavailable too) and must survive the temporary failure
 * while protected content stays hidden (`web-frontend.md` §4.2).
 */
test('temporarily unavailable preserves the refresh token and offers Retry', async ({ page }) => {
  await page.addInitScript(
    ({ storageKey }) => {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ version: 1, refreshToken: 'outage-refresh-token' }),
      )
    },
    { storageKey: SESSION_REFRESH_STORAGE_KEY },
  )

  await page.goto('/dashboard')

  await expect(
    page.getByRole('heading', { level: 1, name: 'We could not restore your session' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
  // No protected content leaks while unavailable.
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toHaveCount(0)

  const stored = await page.evaluate(({ storageKey }) => window.localStorage.getItem(storageKey), {
    storageKey: SESSION_REFRESH_STORAGE_KEY,
  })
  expect(stored).toContain('outage-refresh-token')
})
