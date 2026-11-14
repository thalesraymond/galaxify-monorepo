import { expect, test, type Locator } from '@playwright/test'

import { seedAuthenticated } from './session'

const longTitle =
  'Review the navigation charts and calibrate every sensor before the next long journey through the outer solar system'

async function expectTaskTitle(title: Locator) {
  await expect(title).toBeVisible()
  await expect(title).toHaveCSS('font-size', '16px')
  await expect(title).toHaveCSS('font-weight', '500')
  await expect(title).toHaveCSS('text-transform', 'none')
  await expect(title).toHaveCSS('letter-spacing', 'normal')
  await expect(title).toHaveCSS('color', 'rgb(255, 255, 255)')
}

for (const viewport of [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`Daily titles keep their task hierarchy at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.clock.setFixedTime(new Date('2026-01-15T09:00:00Z'))
    await seedAuthenticated(page)
    await page.goto('/dailies/new')
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill(longTitle)
    await page.getByRole('button', { name: 'Create Daily', exact: true }).click()
    await expect(page.getByRole('heading', { name: longTitle, exact: true })).toBeVisible()

    if (viewport.width <= 850) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
    }
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Dashboard', exact: true })
      .click()
    await expect(
      page
        .getByRole('region', { name: "Today's Dailies", exact: true })
        .locator('[aria-busy="true"]'),
    ).toHaveCount(0)
    const completedHeading = page.getByRole('heading', { name: 'Completed (1)', exact: true })

    const pendingHeading = page.getByRole('heading', { name: 'Pending', exact: true })
    await expect(pendingHeading).toHaveCSS('font-size', '14px')
    await expect(pendingHeading).toHaveCSS('text-transform', 'uppercase')
    await expect(pendingHeading).toHaveCSS('color', 'rgb(180, 180, 180)')
    // Completed uses its existing disclosure-heading treatment, not the pending label rule.
    await expect(completedHeading).toHaveCSS('margin', '0px')
    await expect(completedHeading).toHaveCSS('text-transform', 'none')

    for (const name of ['Calibrate sensors', 'Stretch the solar sails', longTitle]) {
      await expectTaskTitle(page.getByRole('heading', { name, exact: true }))
    }
    const title = page.getByRole('heading', { name: longTitle, exact: true })
    expect(await title.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    await expect(title).toHaveCSS('text-overflow', 'clip')
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)

    const completedDisclosure = page
      .getByRole('region', { name: "Today's Dailies" })
      .locator('details')
    await completedDisclosure.locator('summary').focus()
    await page.keyboard.press('Space')
    await expectTaskTitle(
      page.getByRole('heading', { name: 'Hydrate the coolant loop', exact: true }),
    )

    const dashboardScreenshot = testInfo.outputPath('dashboard-populated.png')
    await page.screenshot({ path: dashboardScreenshot, fullPage: true })
    await testInfo.attach('dashboard-populated', {
      path: dashboardScreenshot,
      contentType: 'image/png',
    })

    await page.getByRole('button', { name: `Complete ${longTitle}`, exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Completed (2)', exact: true })).toBeVisible()
    if ((await completedDisclosure.getAttribute('open')) === null) {
      await completedDisclosure.locator('summary').focus()
      await page.keyboard.press('Space')
    }
    await expectTaskTitle(page.getByRole('heading', { name: longTitle, exact: true }))

    await page.getByRole('link', { name: 'View all', exact: true }).click()
    await expectTaskTitle(page.getByRole('heading', { name: 'Calibrate sensors', exact: true }))
    await page.getByRole('button', { name: 'Completed', exact: true }).click()
    for (const name of [longTitle, 'Hydrate the coolant loop']) {
      await expectTaskTitle(page.getByRole('heading', { name, exact: true }))
    }
    const dailiesScreenshot = testInfo.outputPath('dailies-populated.png')
    await page.screenshot({ path: dailiesScreenshot, fullPage: true })
    await testInfo.attach('dailies-populated', {
      path: dailiesScreenshot,
      contentType: 'image/png',
    })
  })
}
