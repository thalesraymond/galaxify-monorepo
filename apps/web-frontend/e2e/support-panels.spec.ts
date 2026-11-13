import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { seedAuthenticated } from './session'

const viewports = [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const

for (const viewport of viewports) {
  for (const path of [
    '/dashboard',
    '/dailies?date=2026-01-16',
    '/dailies?date=2026-01-16&status=PENDING',
  ]) {
    test(`embedded empty Dailies at ${path} and ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.clock.setFixedTime(new Date('2026-01-15T12:00:00Z'))
      await seedAuthenticated(page)
      // Empty the persisted mock roster so the Dashboard's current day is empty
      // without shifting the clock past the deterministic session fixtures.
      await page.evaluate(() => {
        const key = 'galaxify.mock.v1'
        const stored = localStorage.getItem(key)
        if (stored === null) throw new Error('Mock state is unavailable')
        const data = JSON.parse(stored) as { dailies: unknown[]; revision: number }
        data.dailies = []
        data.revision += 1
        localStorage.setItem(key, JSON.stringify(data))
      })

      await page.goto(path)
      const heading = page.getByRole('heading', { name: /^No Dailies/ })
      await expect(heading).toBeVisible()
      await expect(page.getByRole('link', { name: 'Create Daily', exact: true })).toHaveCount(1)
      const presentation = await heading.locator('..').evaluate((node) => {
        const style = getComputedStyle(node)
        return { padding: style.padding, border: style.borderWidth, textAlign: style.textAlign }
      })
      expect(presentation).toEqual({ padding: '0px', border: '0px', textAlign: 'start' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    })
  }

  test(`repair disclosure remains keyboard accessible at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.clock.setFixedTime(new Date('2026-01-15T12:00:00Z'))
    await seedAuthenticated(page)
    await page.goto('/dashboard')

    const repair = page.getByRole('button', { name: 'Repair Ship' })
    await expect(repair).toBeEnabled()
    await expect(repair).toHaveAccessibleDescription('Spend materials; restoration varies.')
    const summary = page.locator('summary').filter({ hasText: 'How repair works' })
    const mechanics = page.getByText(/Repairing spends materials up to the smaller/)
    await expect(mechanics).toBeHidden()
    await repair.focus()
    await page.keyboard.press('Tab')
    await expect(summary).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(mechanics).toBeVisible()
    const bounds = await summary.boundingBox()
    expect(bounds?.width).toBeGreaterThanOrEqual(44)
    expect(bounds?.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const accessibility = await new AxeBuilder({ page })
      .include('[aria-labelledby="ship-status-heading"]')
      .analyze()
    expect(accessibility.violations).toEqual([])
    await page.keyboard.press('Space')
    await expect(mechanics).toBeHidden()

    // The dedicated Ship consumer uses the same guidance without changing commands.
    const menuButton = page.getByRole('button', { name: 'Menu', exact: true })
    if (await menuButton.isVisible()) {
      await menuButton.click()
    }
    await page.getByRole('link', { name: 'Ship', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Ship' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Repair Ship' })).toBeEnabled()
    await expect(page.locator('summary').filter({ hasText: 'How repair works' })).toBeVisible()
  })
}
