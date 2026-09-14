import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/** WCAG A/AA rule tags. A violation on any of these blocks the gate. */
const wcagLevelAaTags = new Set(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])

/** Desktop, mobile, and 320 px reflow viewports required by issue #146. */
const representativeViewports = [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]

async function expectNoWcagAaViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  const blockingViolations = results.violations.filter((violation) =>
    violation.tags.some((tag) => wcagLevelAaTags.has(tag)),
  )
  expect(blockingViolations, JSON.stringify(blockingViolations, null, 2)).toEqual([])
}

test('the responsive shell has no WCAG A/AA accessibility violations', async ({ page }) => {
  for (const viewport of representativeViewports) {
    await page.setViewportSize(viewport)
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
    await expectNoWcagAaViolations(page)
  }
})

test('form, loading, empty, error, and dialog states have no WCAG A/AA violations', async ({
  page,
}) => {
  for (const viewport of representativeViewports) {
    await page.setViewportSize(viewport)
    await page.goto('/__design-system-preview')
    await expect(page.getByRole('heading', { level: 1, name: 'Interface states' })).toBeVisible()
    await expectNoWcagAaViolations(page)

    await page.getByRole('button', { name: 'Delete Daily' }).click()
    await expect(page.getByRole('dialog', { name: 'Delete Daily' })).toBeVisible()
    await expectNoWcagAaViolations(page)

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Delete Daily' })).toBeHidden()
  }
})
