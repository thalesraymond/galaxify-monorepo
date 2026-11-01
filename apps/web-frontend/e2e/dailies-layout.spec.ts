import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { seedAuthenticated } from './session'

const viewports = [
  { width: 390, height: 844 },
  { width: 320, height: 700 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]

for (const viewport of viewports) {
  test(`Daily work precedes chrome at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.clock.setFixedTime(new Date('2026-01-15T09:00:00Z'))
    await seedAuthenticated(page)
    await page.goto('/dailies')
    const action = page.getByRole('button', { name: 'Complete Stretch the solar sails' })
    await expect(action).toBeVisible()
    const heading = await page
      .getByRole('heading', { name: 'Stretch the solar sails' })
      .boundingBox()
    const actionBox = await action.boundingBox()
    const navigation = await page.getByRole('navigation', { name: 'Primary' }).boundingBox()
    await testInfo.attach('initial-placement', {
      body: JSON.stringify({ viewport, heading, action: actionBox, navigation }),
      contentType: 'application/json',
    })
    await testInfo.attach('initial-viewport', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    expect(heading).not.toBeNull()
    expect(actionBox).not.toBeNull()
    expect(navigation).not.toBeNull()
    if (actionBox !== null && navigation !== null && viewport.width < 768) {
      // At 320 px the complete task information wraps; allow at most a short
      // scroll, rather than reducing targets or hiding task facts to force a
      // fit. The 14px navigation labels add ~2px to the fixed bar.
      const scrollAllowance = viewport.width === 320 ? 68 : 0
      expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(navigation.y - 8 + scrollAllowance)
    }
    await expect(page).toHaveScreenshot(`dailies-populated-${viewport.width}.png`, {
      fullPage: true,
    })
    await expectAccessibleReflow(page)
    const date = page.getByLabel('Date', { exact: true })
    await expect(date).toHaveValue('2026-01-15')
    // Date and Today share a row, followed by a balanced previous/next pair.
    const todayBox = await page.getByRole('button', { name: 'Today', exact: true }).boundingBox()
    const dateBox = await date.boundingBox()
    const previousBox = await page.getByRole('button', { name: 'Previous day' }).boundingBox()
    const nextBox = await page.getByRole('button', { name: 'Next day' }).boundingBox()
    expect(Math.abs((dateBox?.y ?? 0) - (todayBox?.y ?? 0))).toBeLessThanOrEqual(1)
    expect(previousBox?.y).toBe(nextBox?.y)
    for (const control of [dateBox, todayBox, previousBox, nextBox]) {
      expect(control?.width).toBeGreaterThanOrEqual(44)
      expect(control?.height).toBeGreaterThanOrEqual(44)
    }
    // Keyboard traversal can scroll the last action completely clear of the nav.
    await page.getByRole('button', { name: 'Completed', exact: true }).focus()
    const lastAction = page.getByRole('button', { name: 'Delete Calibrate sensors' })
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press('Tab')
      if (await lastAction.evaluate((node) => node === document.activeElement)) break
    }
    await expect(lastAction).toBeFocused()
    if (viewport.width < 768) {
      const focusedBox = await lastAction.boundingBox()
      expect(focusedBox).not.toBeNull()
      if (focusedBox !== null && navigation !== null) {
        expect(focusedBox.y).toBeGreaterThanOrEqual(64)
        expect(focusedBox.y + focusedBox.height).toBeLessThanOrEqual(navigation.y - 8)
      }
    }
  })

  test(`Daily list states reflow at ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.clock.setFixedTime(new Date('2026-01-15T09:00:00Z'))
    await seedAuthenticated(page)
    await page.goto('/dailies?status=COMPLETED')
    await expect(page.getByRole('heading', { name: 'Hydrate the coolant loop' })).toBeVisible()
    await expectAccessibleReflow(page)
    await testInfo.attach('completed-only', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    await page.getByRole('button', { name: 'Next day' }).click()
    await expect(page.getByRole('heading', { name: 'No Dailies' })).toBeVisible()
    await expectAccessibleReflow(page)
    await testInfo.attach('empty', { body: await page.screenshot(), contentType: 'image/png' })

    // Gate the mock read after genuine session bootstrap, then release a failure.
    await page.evaluate(() => {
      const runtime = window.__galaxifyMock
      if (runtime === undefined) throw new Error('Mock runtime is unavailable')
      const backend = runtime.backend
      const originalDelay = backend.awaitResponseDelay.bind(backend)
      const originalList = backend.listDailies.bind(backend)
      const release = new Promise<void>((resolve) => {
        window.addEventListener(
          'release-daily-read',
          () => {
            resolve()
          },
          { once: true },
        )
      })
      window.addEventListener(
        'recover-daily-read',
        () => {
          backend.awaitResponseDelay = originalDelay
          backend.listDailies = originalList
        },
        { once: true },
      )
      backend.awaitResponseDelay = () => release
      backend.listDailies = () => {
        throw new Error('List unavailable.')
      }
    })
    await page.getByRole('button', { name: 'Next day' }).click()
    const surface = page.getByRole('region', { name: 'Current Dailies' })
    await expect(surface.locator('[aria-hidden="true"]')).toBeVisible()
    await expectAccessibleReflow(page)
    await testInfo.attach('loading', { body: await page.screenshot(), contentType: 'image/png' })
    await page.evaluate(() => window.dispatchEvent(new Event('release-daily-read')))
    await expect(page.getByRole('heading', { name: 'Dailies are unavailable' })).toBeVisible()
    await expectAccessibleReflow(page)
    await testInfo.attach('unavailable', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.evaluate(() => window.dispatchEvent(new Event('recover-daily-read')))
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'No Dailies' })).toBeVisible()
  })
}

test('date, filters, History, and browser navigation retain their URL semantics', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.setFixedTime(new Date('2026-01-15T09:00:00Z'))
  await seedAuthenticated(page)
  await page.goto('/dailies')
  await expect(page.getByRole('heading', { name: 'Stretch the solar sails' })).toBeVisible()
  await page.getByRole('button', { name: 'Pending', exact: true }).click()
  await expect(page).toHaveURL(/\/dailies\?status=PENDING$/)
  await expect(page.getByRole('button', { name: 'Pending', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByLabel('Date', { exact: true }).fill('2026-01-14')
  await expect(page).toHaveURL(/status=PENDING&date=2026-01-14$/)
  await page.getByRole('button', { name: 'Next day' }).click()
  await expect(page).toHaveURL(/\/dailies\?status=PENDING$/)
  await page.goBack()
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-01-14')
  await page.goForward()
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-01-15')
  await page.getByRole('button', { name: 'Previous day' }).click()
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-01-15')
  await expect(page.getByRole('button', { name: 'Pending', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page).toHaveURL(/\/dailies$/)
  await page
    .getByRole('navigation', { name: 'Dailies navigation' })
    .getByRole('link', { name: 'History' })
    .click()
  await expect(page).toHaveURL(/\/dailies\/history$/)
  await page
    .getByRole('navigation', { name: 'Dailies navigation' })
    .getByRole('link', { name: 'Current', exact: true })
    .click()
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-01-15')
})

async function expectAccessibleReflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  )
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations).toEqual([])
}
