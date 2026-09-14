import { expect, test } from '@playwright/test'

const shellViewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const

test.describe('shell visual baselines', () => {
  for (const viewport of shellViewports) {
    test(`dashboard shell at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/dashboard')
      await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()

      await expect(page).toHaveScreenshot(`dashboard-shell-${viewport.name}.png`, {
        fullPage: true,
      })
    })
  }
})
