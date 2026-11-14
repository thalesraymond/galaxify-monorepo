import { expect, test } from '@playwright/test'

import { seedAuthenticated } from './session'

test.use({ timezoneId: 'UTC' })

const presentationViewports = [
  { name: 'reflow', width: 320, height: 700 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'zoom', width: 720, height: 450 },
  { name: 'desktop', width: 1440, height: 900 },
] as const

const bandWidths = [479, 480, 481, 639, 640, 641, 849, 850, 851, 1099, 1100, 1101] as const

const stateViewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
] as const

for (const viewport of presentationViewports) {
  test(`dashboard task band presents at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.clock.setFixedTime(new Date('2026-01-15T09:00:00Z'))
    await seedAuthenticated(page)
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()

    const dailies = page.getByRole('region', { name: "Today's Dailies" })
    await expect(dailies.getByRole('link', { name: 'Manage Dailies' })).toHaveAttribute(
      'href',
      '/dailies',
    )

    const ship = page.getByRole('region', { name: 'Ship status' })
    await expect(ship.getByRole('button', { name: 'Repair Ship' })).toBeEnabled()
    await expect(ship.getByRole('link', { name: 'Inspect Ship' })).toHaveAttribute('href', '/ship')
    await expect(ship.locator('summary').filter({ hasText: 'How repair works' })).toHaveCount(0)

    const expedition = page.getByRole('region', { name: 'No Expedition in flight' })
    await expect(expedition.getByRole('link', { name: 'Plan Expedition' })).toHaveAttribute(
      'href',
      '/expeditions',
    )
    await expect(expedition.getByRole('link', { name: 'View history' })).toHaveAttribute(
      'href',
      '/expeditions/history',
    )

    const dailiesBox = await dailies.boundingBox()
    const shipBox = await ship.boundingBox()
    if (dailiesBox === null || shipBox === null) {
      throw new Error('Expected dashboard panels to have bounds')
    }
    expect(dailiesBox.y + dailiesBox.height).toBeLessThanOrEqual(shipBox.y + 1)
    expect(dailiesBox.width).toBeGreaterThanOrEqual(shipBox.width - 1)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)

    const screenshot = testInfo.outputPath(`dashboard-band-${viewport.name}.png`)
    await page.screenshot({ path: screenshot, fullPage: true })
    await testInfo.attach(`dashboard-band-${viewport.name}`, {
      path: screenshot,
      contentType: 'image/png',
    })
  })
}

for (const width of bandWidths) {
  test(`dashboard band layout at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 })
    await page.clock.setFixedTime(new Date('2026-01-15T09:00:00Z'))
    await seedAuthenticated(page)
    await page.goto('/dashboard')

    const dailies = page.getByRole('region', { name: "Today's Dailies" })
    const ship = page.getByRole('region', { name: 'Ship status' })
    const expedition = page.getByRole('region', { name: 'No Expedition in flight' })
    await expect(ship.getByRole('link', { name: 'Inspect Ship' })).toBeVisible()
    await expect(expedition.getByRole('link', { name: 'Plan Expedition' })).toBeVisible()

    const [dailiesBox, shipBox, expeditionBox, diagramBox] = await Promise.all([
      dailies.boundingBox(),
      ship.boundingBox(),
      expedition.boundingBox(),
      ship.getByRole('img', { name: /Ship hull diagram/ }).boundingBox(),
    ])
    if (dailiesBox === null || shipBox === null || expeditionBox === null || diagramBox === null) {
      throw new Error('Expected dashboard panels to have bounds')
    }

    if (width > 1100) {
      expect(shipBox.x).toBeLessThan(expeditionBox.x)
      expect(Math.abs(shipBox.width / expeditionBox.width - 1.4)).toBeLessThan(0.05)
      expect(Math.abs(expeditionBox.y - shipBox.y)).toBeLessThan(2)
      expect(dailiesBox.width).toBeGreaterThan(shipBox.width)
    } else {
      expect(expeditionBox.y - (shipBox.y + shipBox.height)).toBeGreaterThanOrEqual(20)
      expect(Math.abs(shipBox.width - expeditionBox.width)).toBeLessThan(2)
      expect(Math.abs(dailiesBox.width - shipBox.width)).toBeLessThan(2)
    }
    expect(diagramBox.height).toBe(width <= 480 ? 100 : 190)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)

    const screenshot = testInfo.outputPath(`dashboard-band-${width}.png`)
    await page.screenshot({ path: screenshot, fullPage: true })
    await testInfo.attach(`dashboard-band-${width}`, {
      path: screenshot,
      contentType: 'image/png',
    })
  })
}

for (const viewport of stateViewports) {
  test(`dashboard empty day at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.clock.setFixedTime(new Date('2026-01-15T09:00:00Z'))
    await seedAuthenticated(page)
    await page.evaluate(() => {
      const key = 'galaxify.mock.v1'
      const stored = localStorage.getItem(key)
      if (stored === null) throw new Error('Mock state is unavailable')
      const data = JSON.parse(stored) as { dailies: unknown[]; revision: number }
      data.dailies = []
      data.revision += 1
      localStorage.setItem(key, JSON.stringify(data))
    })

    await page.goto('/dashboard')
    const dailies = page.getByRole('region', { name: "Today's Dailies" })
    await expect(dailies.getByRole('heading', { name: 'No Dailies for today' })).toBeVisible()
    await expect(dailies.getByRole('link', { name: 'Create Daily' })).toHaveAttribute(
      'href',
      '/dailies/new',
    )
    await expect(page.getByRole('region', { name: 'Ship status' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'No Expedition in flight' })).toBeVisible()
    await expect(page).toHaveScreenshot(`dashboard-empty-${viewport.name}.png`, {
      fullPage: true,
    })
  })

  test(`dashboard delete dialog at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.clock.setFixedTime(new Date('2026-01-15T09:00:00Z'))
    await seedAuthenticated(page)
    await page.goto('/dashboard')

    await page.getByRole('button', { name: 'Delete Calibrate sensors' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete "Calibrate sensors"?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Delete Daily' })).toBeVisible()
    await expect(page).toHaveScreenshot(`dashboard-delete-dialog-${viewport.name}.png`, {
      fullPage: true,
    })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Calibrate sensors' })).toBeVisible()
  })

  test(`dashboard expedition stale notice after failed refresh at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.clock.setFixedTime(new Date('2026-01-15T09:00:00Z'))
    await seedAuthenticated(page)
    await page.goto('/dashboard')
    await expect(page.getByRole('region', { name: 'No Expedition in flight' })).toBeVisible()
    await page.evaluate(() => {
      const mock = window.__galaxifyMock
      if (mock === undefined) throw new Error('Mock runtime is unavailable')
      mock.backend.getCurrentExpedition = () => {
        throw new Error('Forced Expedition refresh failure')
      }
    })

    await page.getByRole('button', { name: 'Repair Ship' }).click()
    const expedition = page.getByRole('region', { name: 'No Expedition in flight' })
    await expect(
      expedition.getByText('Could not refresh. Showing the last confirmed state.'),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveScreenshot(`dashboard-stale-expedition-${viewport.name}.png`, {
      fullPage: true,
    })
  })
}
