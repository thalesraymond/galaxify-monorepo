import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/** WCAG A/AA rule tags. A violation on any of these blocks the gate. */
const wcagLevelAaTags = new Set(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])

test('the dashboard shell has no WCAG A/AA accessibility violations', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()

  const results = await new AxeBuilder({ page }).analyze()
  const blockingViolations = results.violations.filter((violation) =>
    violation.tags.some((tag) => wcagLevelAaTags.has(tag)),
  )

  expect(blockingViolations, JSON.stringify(blockingViolations, null, 2)).toEqual([])
})
