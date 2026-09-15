import { expect, test } from '@playwright/test'

import {
  expectAuthenticatedDashboard,
  expectNoTokenInUrl,
  expectOnlyRefreshTokenPersisted,
  seedAuthenticated,
  SESSION_REFRESH_STORAGE_KEY,
  waitForMockRuntime,
} from './session'

test.describe('signup and login', () => {
  test('signup enters the partial Dashboard', async ({ page }) => {
    await page.goto('/signup')
    await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible()

    await page.getByLabel('Email').fill('new-captain@galaxify.test')
    await page.getByLabel('Username').fill('new-captain')
    await page.getByLabel('Password').fill('password123')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expectAuthenticatedDashboard(page)
    expectNoTokenInUrl(page)
  })

  test('login authenticates a returning Player', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()

    await page.getByLabel('Email').fill('captain@galaxify.test')
    await page.getByLabel('Password').fill('password123')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expectAuthenticatedDashboard(page)
  })

  test('preserves a safe return route across sign-in', async ({ page }) => {
    await page.goto('/ship')
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()

    await page.getByLabel('Email').fill('captain@galaxify.test')
    await page.getByLabel('Password').fill('password123')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Ship' })).toBeVisible()
    await expect(page).toHaveURL(/\/ship$/)
  })

  test('validation errors stay inline and accessible', async ({ page }) => {
    await page.goto('/signup')
    await waitForMockRuntime(page)

    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByText('Enter your email address.')).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Email')).toBeFocused()
  })
})

test.describe('session lifecycle', () => {
  test('restores the session on reload and rotates safely across tabs', async ({
    page,
    context,
  }) => {
    await seedAuthenticated(page)
    await page.goto('/dashboard')
    await expectAuthenticatedDashboard(page)

    await page.reload()
    await expectAuthenticatedDashboard(page)

    const secondPage = await context.newPage()
    await secondPage.goto('/dashboard')
    await expectAuthenticatedDashboard(secondPage)

    // Concurrent reloads exercise the named Web Lock + post-lock re-read so a
    // single-use refresh token is never overwritten with a consumed value.
    await Promise.all([page.reload(), secondPage.reload()])
    await expectAuthenticatedDashboard(page)
    await expectAuthenticatedDashboard(secondPage)

    await expectOnlyRefreshTokenPersisted(page)
    await secondPage.close()
  })

  test('terminal invalidity routes to Sign in with the exact notice', async ({ page }) => {
    await page.goto('/login')
    await waitForMockRuntime(page)
    await page.evaluate(
      ({ storageKey }) => {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ version: 1, refreshToken: 'terminally-invalid-token' }),
        )
      },
      { storageKey: SESSION_REFRESH_STORAGE_KEY },
    )

    await page.goto('/dashboard')

    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    await expect(page.getByText('Your session ended. Sign in again.')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
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

test.describe('Profile and account actions', () => {
  test('updates the username inline', async ({ page }) => {
    await seedAuthenticated(page)
    await page.goto('/profile')
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()

    const username = page.getByLabel('Username')
    await username.fill('nova-captain')
    await page.getByRole('button', { name: 'Save username' }).click()

    await expect(username).toHaveValue('nova-captain')
    await expect(page.getByText('Your username was updated.')).toBeAttached()
  })

  test('deletes the account with a password and lands on Signup', async ({ page }) => {
    await seedAuthenticated(page)
    await page.goto('/profile')
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()

    await page.getByRole('button', { name: 'Delete account' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete your account' })
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('Password').fill('password123')
    await dialog.getByRole('button', { name: 'Delete account' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible()
    const stored = await page.evaluate(
      ({ storageKey }) => window.localStorage.getItem(storageKey),
      { storageKey: SESSION_REFRESH_STORAGE_KEY },
    )
    expect(stored).toBeNull()
  })
})
