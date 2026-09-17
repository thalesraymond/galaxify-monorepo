import { expect, test } from '@playwright/test'

import {
  expectAuthenticatedDashboard,
  expectNoTokenInUrl,
  expectOnlyRefreshTokenPersisted,
  seedAuthenticated,
  SESSION_REFRESH_STORAGE_KEY,
} from './session'

/**
 * Cross-engine release journeys (`web-frontend-delivery.md` §6): Firefox,
 * WebKit, and mobile WebKit cover representative signup/session restore,
 * primary navigation, one mutation/recovery path, and logout. Chromium owns the
 * full deterministic matrix in the other specs, so this file is matched only by
 * the firefox, webkit, and mobile-webkit projects and stays engine-neutral.
 */
test.describe('cross-browser release journeys', () => {
  test('signup enters the app and the session survives a reload', async ({ page }) => {
    await page.goto('/signup')
    await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible()

    await page.getByLabel('Email').fill('engine-captain@galaxify.test')
    await page.getByLabel('Username').fill('engine-captain')
    await page.getByLabel('Password').fill('password123')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expectAuthenticatedDashboard(page)
    expectNoTokenInUrl(page)
    await expectOnlyRefreshTokenPersisted(page)

    await page.reload()
    await expectAuthenticatedDashboard(page)
    await expectOnlyRefreshTokenPersisted(page)
  })

  test('primary navigation reaches every primary route', async ({ page }) => {
    await seedAuthenticated(page)
    await page.goto('/dashboard')
    await expectAuthenticatedDashboard(page)

    const primaryNav = page.getByRole('navigation', { name: 'Primary' })
    for (const route of [
      { label: 'Dailies', heading: 'Dailies', url: /\/dailies$/ },
      { label: 'Ship', heading: 'Ship', url: /\/ship$/ },
      { label: 'Expeditions', heading: 'Expeditions', url: /\/expeditions$/ },
      { label: 'Dashboard', heading: 'Dashboard', url: /\/dashboard$/ },
    ]) {
      await primaryNav.getByRole('link', { name: route.label }).click()
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible()
      await expect(page).toHaveURL(route.url)
    }
  })

  test('a rejected username mutation recovers inline and announces success', async ({ page }) => {
    await seedAuthenticated(page)
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window)
      let rejectedOnce = false
      window.fetch = async (input, init) => {
        const request = new Request(input, init)
        if (
          !rejectedOnce &&
          request.method === 'PATCH' &&
          new URL(request.url).pathname === '/api/user/users/me'
        ) {
          rejectedOnce = true
          return new Response(
            JSON.stringify({
              error: { code: 'USER_USERNAME_TAKEN', message: 'Username is already taken.' },
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return nativeFetch(input, init)
      }
    })
    await page.goto('/profile')
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()

    const username = page.getByLabel('Username')
    await username.fill('engine-captain')
    await page.getByRole('button', { name: 'Save username' }).click()

    await expect(page.getByText('That username is already taken.')).toBeVisible()
    await expect(username).toHaveAttribute('aria-invalid', 'true')

    await page.getByRole('button', { name: 'Save username' }).click()
    await expect(username).toHaveValue('engine-captain')
    await expect(page.getByText('Your username was updated.')).toBeAttached()
  })

  test('logout completes locally and clears the stored token', async ({ page }) => {
    await seedAuthenticated(page)
    await page.goto('/dashboard')
    await expectAuthenticatedDashboard(page)

    await page.getByRole('button', { name: 'Account' }).first().click()
    await page.getByRole('menuitem', { name: 'Log out' }).first().click()

    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    await expect(page.getByText('You have been signed out.', { exact: true })).toBeVisible()
    const stored = await page.evaluate(
      ({ storageKey }) => window.localStorage.getItem(storageKey),
      { storageKey: SESSION_REFRESH_STORAGE_KEY },
    )
    expect(stored).toBeNull()
  })
})
