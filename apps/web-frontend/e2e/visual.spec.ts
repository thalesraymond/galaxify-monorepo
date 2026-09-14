import { expect, test } from '@playwright/test'

const shellViewports = [
  { name: 'reflow', width: 320, height: 700 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const

/** Representative state coverage: mobile, desktop, and 320 px reflow. */
const stateViewports = [shellViewports[0], shellViewports[1], shellViewports[3]] as const

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

test.describe('interface state visual baselines', () => {
  for (const viewport of stateViewports) {
    test(`form, loading, empty, error, and dialog states at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/__design-system-preview')
      await expect(page.getByRole('heading', { level: 1, name: 'Interface states' })).toBeVisible()

      await expect(page).toHaveScreenshot(`design-system-states-${viewport.name}.png`, {
        fullPage: true,
      })

      await page.getByRole('button', { name: 'Delete Daily' }).click()
      await expect(page.getByRole('dialog', { name: 'Delete Daily' })).toBeVisible()
      await expect(page).toHaveScreenshot(`design-system-dialog-${viewport.name}.png`)
    })
  }
})
