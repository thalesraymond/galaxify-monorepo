import { expect, type Page } from '@playwright/test'

import { expectAuthenticatedDashboard, seedAuthenticated } from './session'

const errorBoundaryViewports = [
  { width: 1440, height: 900 },
  { width: 320, height: 700 },
] as const

/**
 * Triggers a single lazy route chunk failure for `/ship`, runs the caller's
 * boundary assertion across desktop and 320 px viewports, and verifies
 * recovery back to `/dashboard`.
 */
export async function expectRouteChunkErrorBoundary(
  page: Page,
  verifyBoundary: (page: Page) => Promise<void>,
): Promise<void> {
  await seedAuthenticated(page)
  for (const viewport of errorBoundaryViewports) {
    await page.setViewportSize(viewport)
    await page.goto('/dashboard')
    await expectAuthenticatedDashboard(page)

    const context = page.context()
    const abortShipChunk = (route: Parameters<Parameters<typeof context.route>[1]>[0]) =>
      route.abort()
    await context.route('**/src/app/pages/ShipPage.tsx*', abortShipChunk, { times: 1 })

    try {
      if (viewport.width <= 850) {
        await page.getByRole('button', { name: 'Menu', exact: true }).click()
      }
      await page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: 'Ship' })
        .click()

      await expect(
        page.getByRole('heading', { level: 1, name: 'Something went wrong' }),
      ).toBeVisible()
      await verifyBoundary(page)
      await page.getByRole('link', { name: 'Back to Dashboard' }).click()
      await expectAuthenticatedDashboard(page)
    } finally {
      await context.unroute('**/src/app/pages/ShipPage.tsx*', abortShipChunk)
    }
  }
}
