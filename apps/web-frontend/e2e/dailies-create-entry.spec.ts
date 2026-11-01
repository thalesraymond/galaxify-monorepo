import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { seedAuthenticated } from './session'

test.use({ timezoneId: 'UTC' })
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T09:00:00Z'))
  await seedAuthenticated(page)
})

for (const viewport of [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`persistent creation, reflow, keyboard and accessibility at ${viewport.width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto('/dailies?date=2026-01-15')
    await expect(page.getByRole('heading', { name: 'Calibrate sensors' })).toBeVisible()
    const create = page.getByRole('link', { name: 'Create Daily', exact: true })
    await expect(create).toHaveCount(1)
    for (
      let index = 0;
      index < 15 && !(await create.evaluate((element) => element === document.activeElement));
      index += 1
    ) {
      await page.keyboard.press('Tab')
    }
    await expect(create).toBeFocused()
    const geometry = await create.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        width: rect.width,
        height: rect.height,
        outline: style.outlineStyle,
        unobscured: element.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        ),
      }
    })
    expect(geometry.width).toBeGreaterThanOrEqual(44)
    expect(geometry.height).toBeGreaterThanOrEqual(44)
    expect(geometry.outline).not.toBe('none')
    expect(geometry.unobscured).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width)
    await page.screenshot({ path: testInfo.outputPath('populated.png'), fullPage: true })
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([])

    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/dailies\/new$/)
    await page.getByRole('link', { name: 'Back to Dailies' }).click()
    await page.getByRole('button', { name: 'Completed', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Hydrate the coolant loop' })).toBeVisible()
    await expect(create).toHaveCount(1)
    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(page.getByRole('heading', { name: 'No Dailies' })).toBeVisible()
    await expect(create).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath('filtered-empty.png'), fullPage: true })
    await create.click()
    await page.getByRole('button', { name: 'Create Daily', exact: true }).click()
    await expect(page.getByText('Enter a title.')).toBeVisible()
    await page.getByLabel('Title', { exact: true }).fill('Inspect the navigation log')
    await page.getByRole('button', { name: 'Create Daily', exact: true }).click()
    await expect(page).toHaveURL(/\/dailies$/)
    await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-01-15')
    await expect(page.getByRole('heading', { name: 'Inspect the navigation log' })).toBeFocused()
    await expect(page.getByText('Created Daily "Inspect the navigation log".')).toBeVisible()
  })
}
