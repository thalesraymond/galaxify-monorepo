import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { seedAuthenticated } from './session'

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T09:00:00Z'))
  await seedAuthenticated(page)
})

for (const width of [320, 390]) {
  test(`mobile destinations stay readable, dismiss on Escape, and focus route h1 at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 })
    await page.goto('/dashboard')

    const menuButton = page.getByRole('button', { name: 'Menu', exact: true })
    const nav = page.getByRole('navigation', { name: 'Primary' })

    await expect(menuButton).toBeVisible()
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    await expect(nav).toBeHidden()

    await menuButton.click()
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true')
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('link')).toHaveText(['Dashboard', 'Dailies', 'Ship', 'Expeditions'])

    await page.keyboard.press('Escape')
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    await expect(nav).toBeHidden()
    await expect(menuButton).toBeFocused()

    for (const label of ['Dailies', 'Ship', 'Expeditions', 'Dashboard']) {
      await menuButton.click()
      await expect(nav).toBeVisible()
      const link = nav.getByRole('link', { name: label, exact: true })
      const geometry = await link.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return {
          fontSize: parseFloat(getComputedStyle(element).fontSize),
          width: rect.width,
          height: rect.height,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }
      })
      expect(geometry.fontSize).toBeGreaterThanOrEqual(14)
      expect(geometry.width).toBeGreaterThanOrEqual(44)
      expect(geometry.height).toBeGreaterThanOrEqual(44)
      expect(geometry.overflow).toBe(false)

      await link.click()
      await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
      await expect(nav).toBeHidden()
      const heading = page.getByRole('heading', { level: 1, name: label, exact: true })
      await expect(heading).toBeVisible()
      await expect(heading).toBeFocused()
      await menuButton.click()
      await expect(link).toHaveAttribute('aria-current', 'page')
      await page.keyboard.press('Escape')
    }
  })
}

test('responsive navigation toggles cleanly across the 850px breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 900 })
  await page.goto('/dashboard')
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden()

  await page.setViewportSize({ width: 851, height: 900 })
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeHidden()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
})

for (const viewport of [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 720, height: 450 }, // 200% desktop zoom's CSS viewport, matching the release checklist.
]) {
  for (const route of ['dashboard', 'dailies']) {
    test(`${route} disclosure presentation at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto(`/${route}`)
      const summary = page.locator('summary').filter({ hasText: /^Completed \(/ })
      await expect(summary).toHaveText('Completed (1)')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await expect(page).toHaveScreenshot(`${route}-${viewport.width}-collapsed.png`, {
        fullPage: true,
      })
      await summary.focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('details[open]').filter({ has: summary })).toBeVisible()
      await expect(summary).toBeFocused()
      await expect(summary).toHaveCSS('outline-style', 'solid')
      await expect(page).toHaveScreenshot(`${route}-${viewport.width}-expanded-focus.png`)
      await summary.scrollIntoViewIfNeeded()
      const summaryBox = await summary.boundingBox()
      if (summaryBox === null) throw new Error('Summary is hidden')
      expect(summaryBox.y + summaryBox.height).toBeLessThanOrEqual(viewport.height)
    })
  }
}

for (const route of ['/dashboard', '/dailies']) {
  test(`${route} native Completed disclosure supports keyboard and completion`, async ({
    page,
  }) => {
    await page.goto(route)
    const summary = page.locator('summary').filter({ hasText: /^Completed \(/ })
    await expect(summary).toHaveText('Completed (1)')
    const details = page.locator('details').filter({ has: summary })
    await expect(details).not.toHaveAttribute('open')
    await expect(summary).toHaveAccessibleName('Completed (1)')
    const completedHeading = details.getByRole('heading', { name: 'Hydrate the coolant loop' })
    await expect(completedHeading).toBeHidden()
    await expect(summary).not.toHaveAttribute('aria-expanded')
    const indicator = summary.locator('[aria-hidden="true"]')
    await expect(indicator).toBeVisible()
    const closedTransform = await indicator.evaluate(
      (element) => getComputedStyle(element).transform,
    )
    await summary.focus()
    await page.keyboard.press('Enter')
    await expect(details).toHaveAttribute('open')
    expect(await indicator.evaluate((element) => getComputedStyle(element).transform)).not.toBe(
      closedTransform,
    )
    await expect(completedHeading).toBeVisible()
    await page.keyboard.press('Space')
    await expect(details).not.toHaveAttribute('open')
    await expect(completedHeading).toBeHidden()
    await page.getByRole('button', { name: 'Complete Calibrate sensors', exact: true }).click()
    await expect(summary).toHaveText('Completed (2)')
    await expect(details).not.toHaveAttribute('open')
    await summary.focus()
    await page.keyboard.press('Space')
    await expect(details).toHaveAttribute('open')
    await expect(summary).toBeFocused()
    await expect(
      details.getByRole('heading', { name: 'Calibrate sensors', exact: true }),
    ).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
    if (route === '/dailies') {
      await page.keyboard.press('Space')
      await expect(details).not.toHaveAttribute('open')
      await page.getByRole('button', { name: 'Completed', exact: true }).click()
      await expect(details).toHaveAttribute('open')
      await expect(summary).toHaveText('Completed (2)')
    }
  })
}
