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
    await expect(page).toHaveScreenshot(`ship-${viewport.name}.png`, { fullPage: true })
    const shipWidth = await page
      .getByRole('region', { name: 'Ship status' })
      .evaluate((node) => node.getBoundingClientRect().width)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.getByRole('button', { name: 'Repair Ship' }).click()
    await expect(gauge).toHaveAttribute('aria-valuenow', '100')
    await expect(page.getByRole('button', { name: 'Repair Ship' })).toBeDisabled()
    await expectReflow(page)

    if (viewport.name === 'desktop') {
      expect(identityWidth).toBeLessThanOrEqual(480)
      expect(dailyWidth).toBeLessThanOrEqual(608)
      expect(shipWidth).toBeLessThanOrEqual(640)
    }
  })
}
