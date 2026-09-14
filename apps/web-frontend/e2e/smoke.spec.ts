import { expect, test } from '@playwright/test'

const primaryNavLabels = ['Dashboard', 'Dailies', 'Ship', 'Expeditions'] as const

test.describe('application shell', () => {
  test('keeps primary navigation and content usable from 320 px through desktop', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 320, height: 700 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport)
      await page.goto('/dashboard')
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
    }
  })

  test('boots the app shell with the primary navigation', async ({ page }) => {
    await page.goto('/dashboard')

    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('link', { name: /skip to main content/i })).toHaveAttribute(
      'href',
      '#main-content',
    )

    const primaryNav = page.getByRole('navigation', { name: 'Primary' })
    await expect(primaryNav).toBeVisible()
    for (const label of primaryNavLabels) {
      await expect(primaryNav.getByRole('link', { name: label })).toBeVisible()
    }
  })

  test('navigates between primary routes', async ({ page }) => {
    await page.goto('/dashboard')

    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Dailies' })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: 'Dailies' })).toBeVisible()
    await expect(page).toHaveURL(/\/dailies$/)
  })

  test('shows a contextual not-found state for an unknown route', async ({ page }) => {
    await page.goto('/this-route-does-not-exist')

    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
  })
})
