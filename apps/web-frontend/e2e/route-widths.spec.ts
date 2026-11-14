import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { seedAuthenticated } from './session'

test.use({ timezoneId: 'UTC' })

const viewports = [
  { name: 'reflow', width: 320, height: 700 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'zoom', width: 720, height: 450 },
] as const

async function expectReflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0)
}

for (const viewport of viewports) {
  test(`route-local measures and interactions at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.clock.setFixedTime(new Date('2026-01-15T09:00:00Z'))
    await seedAuthenticated(page)

    await page.goto('/profile')
    await expect(page.getByLabel('Username')).toHaveValue('captain-logs')
    await expect(page).toHaveScreenshot(`profile-${viewport.name}.png`, { fullPage: true })
    const identityWidth = await page
      .getByRole('region', { name: 'Identity' })
      .evaluate((node) => node.getBoundingClientRect().width)
    await page.getByLabel('Username').fill('x')
    await page.getByRole('button', { name: 'Save username' }).click()
    await expect(page.getByText('Username must be 3–30 characters.')).toBeVisible()
    await page.getByLabel('Username').fill('captain-widths')
    await page.getByRole('button', { name: 'Save username' }).click()
    await expect(page.getByText('Your username was updated.')).toBeAttached()
    const deleteTrigger = page.getByRole('button', { name: 'Delete account', exact: true })
    await deleteTrigger.click()
    const dialog = page.getByRole('dialog', { name: 'Delete your account' })
    await dialog.getByRole('button', { name: 'Delete account', exact: true }).click()
    await expect(dialog.getByText('Enter your password to confirm.')).toBeVisible()
    await expect(page).toHaveScreenshot(`profile-dialog-${viewport.name}.png`)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await expectReflow(page)
    await page.keyboard.press('Escape')
    await expect(deleteTrigger).toBeFocused()

    await page.goto('/dailies/new')
    await expect(page.getByRole('radio', { name: /Easy — rewards/ })).toBeVisible()
    await page.getByRole('button', { name: 'Create Daily', exact: true }).click()
    await expect(page.getByText('Enter a title.')).toBeVisible()
    await expect(page).toHaveScreenshot(`daily-create-${viewport.name}.png`, { fullPage: true })
    const dailyWidth = await page
      .getByRole('region', { name: 'New Daily' })
      .evaluate((node) => node.getBoundingClientRect().width)
    await page.getByLabel('Title', { exact: true }).fill('A carefully composed Daily')
    await page.getByLabel('Description', { exact: true }).fill('Long detail. '.repeat(75))
    await page.getByRole('link', { name: 'Back to Dailies' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
      'A carefully composed Daily',
    )
    await expectReflow(page)
    await page.getByRole('button', { name: 'Create Daily', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Dailies', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'A carefully composed Daily' })).toBeVisible()

    // A completed fixture exercises the recurrence notice as well as editing.
    await page.getByRole('heading', { name: 'Completed (1)', exact: true }).click()
    await page.locator('a[href="/dailies/00000001-0000-4000-8000-000000000002/edit"]').click()
    await expect(page.getByText('This Daily is already completed.')).toBeVisible()
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Hydrate the coolant loop')
    await page.getByLabel('Description', { exact: true }).fill('Long detail. '.repeat(75))
    await expect(page).toHaveScreenshot(`daily-edit-${viewport.name}.png`, { fullPage: true })
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await expectReflow(page)
    await page.getByLabel('Title', { exact: true }).fill('Edited coolant loop')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Updated Daily "Edited coolant loop".')).toBeAttached()

    const menuButton = page.getByRole('button', { name: 'Menu', exact: true })
    if (await menuButton.isVisible()) {
      await menuButton.click()
    }
    await page.getByRole('link', { name: 'Ship', exact: true }).click()
    const gauge = page.getByRole('progressbar', { name: 'Hull health' })
    await expect(gauge).toHaveAttribute('aria-valuenow', '96')
    await expect(page.getByRole('region', { name: 'No Expedition in flight' })).toBeVisible()
    const diagram = page.getByRole('img', {
      name: 'Ship hull diagram: 96 of 100 cells intact',
    })
    await expect(diagram.locator('rect')).toHaveCount(100)
    await expect(diagram.locator('[data-state="intact"]')).toHaveCount(96)
    await expect(page).toHaveScreenshot(`ship-${viewport.name}.png`, { fullPage: true })
    const shipWidth = await page
      .getByRole('region', { name: 'Ship status' })
      .evaluate((node) => node.getBoundingClientRect().width)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.getByRole('button', { name: 'Repair Ship' }).click()
    await expect(gauge).toHaveAttribute('aria-valuenow', '100')
    await expect(
      page.getByRole('img', { name: 'Ship hull diagram: 100 of 100 cells intact' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Repair Ship' })).toBeDisabled()
    await expectReflow(page)

    if (viewport.name === 'desktop') {
      // Identity owns the wider 1.4fr Profile track (frontend-redesign §3).
      expect(identityWidth).toBeGreaterThan(480)
      expect(dailyWidth).toBeLessThanOrEqual(760)
      const expeditionWidth = await page
        .getByRole('region', { name: 'No Expedition in flight' })
        .evaluate((node) => node.getBoundingClientRect().width)
      expect(shipWidth / expeditionWidth).toBeCloseTo(1.4, 1)
    }
  })
}

async function openShipCondition(page: Page, hull: number, materials: number) {
  await page.clock.setFixedTime(new Date('2026-01-15T09:00:00Z'))
  await seedAuthenticated(page)
  await page.goto('/profile')
  await expect(page.getByLabel('Username')).toHaveValue('captain-logs')
  await page.evaluate(
    ({ hull, materials }) => {
      const backend = window.__galaxifyMock?.backend
      if (backend === undefined) throw new Error('The mock runtime is unavailable')
      const getShip = backend.getShip.bind(backend)
      backend.getShip = (token) => ({
        ...getShip(token),
        hull_health: hull,
        materials_balance: materials,
      })
    },
    { hull, materials },
  )
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  if (await menu.isVisible()) await menu.click()
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', {
      name: 'Ship',
      exact: true,
    })
    .click()
  await expect(page.getByRole('progressbar', { name: 'Hull health' })).toHaveAttribute(
    'aria-valuenow',
    String(hull),
  )
  await expect(page.getByRole('region', { name: 'No Expedition in flight' })).toBeVisible()
}

for (const viewport of viewports.filter((viewport) => viewport.name !== 'zoom')) {
  for (const state of [
    { name: 'empty-hull', hull: 0, materials: 120 },
    { name: 'damaged', hull: 42, materials: 120 },
    { name: 'full-hull', hull: 100, materials: 120 },
    { name: 'zero-materials', hull: 42, materials: 0 },
  ]) {
    test(`Ship condition ${state.name} at ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport)
      await openShipCondition(page, state.hull, state.materials)
      const ship = page.getByRole('region', { name: 'Ship status' })
      const diagram = ship.getByRole('img', {
        name: `Ship hull diagram: ${state.hull} of 100 cells intact`,
      })
      await expect(diagram.locator('rect')).toHaveCount(100)
      await expect(diagram.locator('[data-state="intact"]')).toHaveCount(state.hull)
      await expect(ship.getByRole('region', { name: 'Materials' })).toContainText(
        String(state.materials),
      )
      const repair = ship.getByRole('button', { name: 'Repair Ship' })
      if (state.hull === 100 || state.materials === 0) await expect(repair).toBeDisabled()
      else await expect(repair).toBeEnabled()
      for (const control of [repair, ship.locator('summary')]) {
        const box = await control.boundingBox()
        expect(box?.height).toBeGreaterThanOrEqual(44)
        expect(box?.width).toBeGreaterThanOrEqual(44)
      }
      await expectReflow(page)
      await testInfo.attach(`ship-condition-${state.name}-${viewport.name}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
      await expect(page).toHaveScreenshot(`ship-condition-${state.name}-${viewport.name}.png`, {
        fullPage: true,
      })
    })
  }
}

for (const width of [479, 480, 481, 639, 640, 641, 849, 850, 851, 1099, 1100, 1101]) {
  test(`Ship condition breakpoint ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await openShipCondition(page, 42, 120)
    const ship = await page.getByRole('region', { name: 'Ship status' }).boundingBox()
    const expedition = await page
      .getByRole('region', { name: 'No Expedition in flight' })
      .boundingBox()
    const diagram = await page
      .getByRole('img', {
        name: 'Ship hull diagram: 42 of 100 cells intact',
      })
      .boundingBox()
    const gauge = await page.getByRole('progressbar', { name: 'Hull health' }).boundingBox()
    expect(ship).not.toBeNull()
    expect(expedition).not.toBeNull()
    expect(diagram?.height).toBe(width <= 480 ? 100 : 220)
    if (ship !== null && expedition !== null && diagram !== null && gauge !== null) {
      if (width <= 1100) expect(expedition.y).toBeGreaterThanOrEqual(ship.y + ship.height + 23)
      else expect(ship.width / expedition.width).toBeCloseTo(1.4, 1)
      if (width <= 480) expect(gauge.y).toBeGreaterThan(diagram.y + diagram.height)
      else expect(gauge.x).toBeGreaterThan(diagram.x + diagram.width)
    }
    await expectReflow(page)
    await testInfo.attach(`ship-breakpoint-${width}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })
}

test('Ship keyboard repair and disclosure at 200 percent equivalent viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 720, height: 450 })
  await openShipCondition(page, 42, 120)
  const repair = page.getByRole('button', { name: 'Repair Ship' })
  await repair.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(repair).toBeFocused()
  expect(await repair.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('solid')
  await page.keyboard.press('Tab')
  const disclosure = page.getByRole('region', { name: 'Ship status' }).locator('summary')
  await expect(disclosure).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Each material restores a variable amount of hull/)).toBeVisible()
  await page.keyboard.press('Shift+Tab')
  await expect(repair).toBeFocused()
  await testInfo.attach('ship-200-percent-focus', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Ship status' })).toBeFocused()
  await expectReflow(page)
})

test('Dashboard Ship facts wrap without splitting the hull label into letters', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.clock.setFixedTime(new Date('2026-01-15T09:00:00Z'))
  await seedAuthenticated(page)
  await page.goto('/dashboard')
  const ship = page.getByRole('region', { name: 'Ship status' })
  await expect(ship.getByRole('progressbar', { name: 'Hull health' })).toBeVisible()
  const label = await ship.getByText('Hull health', { exact: true }).boundingBox()
  expect(label?.width).toBeGreaterThanOrEqual(65)
  expect(label?.height).toBeLessThanOrEqual(24)
  await expectReflow(page)
})
