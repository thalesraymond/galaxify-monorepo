import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { seedAuthenticated, waitForMockRuntime } from './session'

declare global {
  interface Window {
    __launchCalls?: number
    __holdResponses?: boolean
    __responseReleasers?: Array<() => void>
    __expeditionUnavailable?: boolean
  }
}

const EPOCH = new Date('2026-01-15T09:00:00Z')
const RESOLVED_SUCCESS_ID = '00000002-0000-4000-8000-000000000002'

const MAIN_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 700 },
] as const

async function expectAccessibleReflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  )
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations).toEqual([])
}

async function expectPairGeometry(page: Page, sideBySide: boolean): Promise<void> {
  const launchBox = await page.getByRole('region', { name: 'Launch an Expedition' }).boundingBox()
  const shipBox = await page.getByRole('region', { name: 'Ship status' }).boundingBox()
  expect(launchBox).not.toBeNull()
  expect(shipBox).not.toBeNull()
  if (launchBox === null || shipBox === null) {
    return
  }
  if (sideBySide) {
    expect(shipBox.x).toBeGreaterThanOrEqual(launchBox.x + launchBox.width)
  } else {
    expect(shipBox.y).toBeGreaterThanOrEqual(launchBox.y + launchBox.height)
  }
}

test.describe('Expedition planning presentation', () => {
  for (const viewport of MAIN_VIEWPORTS) {
    test(`launch planning pairs with confirmed Ship status at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.clock.setFixedTime(EPOCH)
      await seedAuthenticated(page)
      await page.goto('/expeditions')
      const launchPanel = page.getByRole('region', { name: 'Launch an Expedition' })
      const shipPanel = page.getByRole('region', { name: 'Ship status' })
      await expect(launchPanel).toBeVisible()
      await expect(shipPanel).toBeVisible()
      await expect(shipPanel.getByRole('heading', { name: 'Materials' })).toBeVisible()
      await page.getByLabel('Materials to invest').fill('40')
      await expect(page.getByText('Ready to launch.')).toBeVisible()

      await expectPairGeometry(page, viewport.width > 1100)
      await expectAccessibleReflow(page)
      await expect(page).toHaveScreenshot(`expedition-launch-${viewport.width}.png`, {
        fullPage: true,
      })
    })
  }

  test('the Expedition and Ship pair breaks to one column at 1100 px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.clock.setFixedTime(EPOCH)
    await seedAuthenticated(page)
    await page.goto('/expeditions')
    await expect(page.getByRole('region', { name: 'Ship status' })).toBeVisible()

    await page.setViewportSize({ width: 1120, height: 900 })
    await expectPairGeometry(page, true)
    await page.setViewportSize({ width: 1080, height: 900 })
    await expectPairGeometry(page, false)
  })

  test('the shell collapses primary navigation into the Menu disclosure at 850 px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 880, height: 900 })
    await page.clock.setFixedTime(EPOCH)
    await seedAuthenticated(page)
    await page.goto('/expeditions')
    await expect(page.getByRole('region', { name: 'Launch an Expedition' })).toBeVisible()
    const primaryNav = page.getByRole('navigation', { name: 'Primary' })
    const menuToggle = page.getByRole('button', { name: 'Menu' })
    await expect(menuToggle).toBeHidden()
    await expect(primaryNav.getByRole('link', { name: 'Ship' })).toBeVisible()

    await page.setViewportSize({ width: 840, height: 900 })
    await expect(menuToggle).toBeVisible()
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(primaryNav.getByRole('link', { name: 'Ship' })).toBeHidden()
    await menuToggle.click()
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'true')
    await primaryNav.getByRole('link', { name: 'Ship' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Ship' })).toBeVisible()
  })

  test('the stacked pair keeps usable controls and visible focus at 641-640 and 481-480 px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.clock.setFixedTime(EPOCH)
    await seedAuthenticated(page)
    await page.goto('/expeditions')
    const input = page.getByLabel('Materials to invest')
    await expect(input).toBeVisible()

    for (const width of [641, 640, 481, 480]) {
      await page.setViewportSize({ width, height: 800 })
      await expectPairGeometry(page, false)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBe(0)
      await input.fill('40')
      await expect(page.getByText('Ready to launch.')).toBeVisible()

      await input.focus()
      await page.keyboard.press('Tab')
      const min = page.getByRole('button', { name: 'Min', exact: true })
      await expect(min).toBeFocused()
      const outline = await min.evaluate((element) => {
        const style = getComputedStyle(element)
        return { width: style.outlineWidth, style: style.outlineStyle }
      })
      expect(outline.style).not.toBe('none')
      expect(Number.parseFloat(outline.width)).toBeGreaterThan(0)
    }
  })

  test('keyboard moves from the investment input through shortcuts to Launch and local navigation', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.clock.setFixedTime(EPOCH)
    await seedAuthenticated(page)
    await page.goto('/expeditions')
    const input = page.getByLabel('Materials to invest')
    await expect(input).toBeVisible()
    await input.fill('40')
    await expect(page.getByText('Ready to launch.')).toBeVisible()

    await input.focus()
    for (const name of ['Min', '25%', '50%', 'Max', 'Launch Expedition']) {
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name, exact: true })).toBeFocused()
    }

    const historyTab = page.getByRole('link', { name: 'History', exact: true })
    await historyTab.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1, name: 'Expedition history' })).toBeVisible()
  })

  test('zero-funds shows local guidance and keeps Launch unavailable at 390x844', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.clock.setFixedTime(EPOCH)
    await seedAuthenticated(page)
    await page.goto('/expeditions/history')
    await waitForMockRuntime(page)
    await page.evaluate(() => {
      const runtime = window.__galaxifyMock
      if (runtime === undefined) throw new Error('Mock runtime is unavailable')
      const { backend } = runtime
      const getShip = backend.getShip.bind(backend)
      backend.getShip = (token) => ({ ...getShip(token), materials_balance: 0 })
    })
    await page.getByRole('link', { name: 'Overview' }).click()
    const launchPanel = page.getByRole('region', { name: 'Launch an Expedition' })
    await expect(launchPanel).toBeVisible()
    await expect(launchPanel.getByText('You have 0 materials')).toBeVisible()
    await expect(
      launchPanel.getByText(/No materials\. Complete Dailies to earn materials/),
    ).toBeVisible()
    await expect(launchPanel.getByRole('link', { name: 'Open Dailies' })).toBeVisible()
    await expect(launchPanel.getByRole('button', { name: 'Launch Expedition' })).toBeDisabled()
    await page.getByLabel('Materials to invest').fill('1')
    await expect(launchPanel.getByText('Ready to launch.')).toHaveCount(0)
    await expectAccessibleReflow(page)
    await expect(page).toHaveScreenshot('expedition-zero-funds-390.png', { fullPage: true })
  })
})

test.describe('Expedition states presentation', () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ] as const) {
    test(`in-flight progress pairs with Ship status at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.clock.setFixedTime(EPOCH)
      await seedAuthenticated(page)
      await page.goto('/expeditions')
      await page.getByLabel('Materials to invest').fill('40')
      await expect(page.getByText('Ready to launch.')).toBeVisible()
      await page.getByRole('button', { name: 'Launch Expedition' }).click()
      await expect(page.getByRole('heading', { name: 'Expedition in flight' })).toBeVisible({
        timeout: 10_000,
      })
      const countdown = page.getByText(/\d+h \d+m \d+s/)
      await expect(countdown).toBeVisible()
      await expect(countdown).not.toHaveAttribute('aria-live')
      expect(await countdown.getAttribute('role')).toBeNull()
      await expect(page.getByRole('region', { name: 'Ship status' })).toBeVisible()
      await expect(page.getByText('Updating…')).toHaveCount(0, { timeout: 10_000 })
      await expectAccessibleReflow(page)
      await expect(page).toHaveScreenshot(`expedition-inflight-${viewport.width}.png`, {
        fullPage: true,
        mask: [countdown],
      })
    })
  }

  test('resolved detail keeps mission facts under the typed Success reward at 1440x900', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.clock.setFixedTime(EPOCH)
    await seedAuthenticated(page)
    await page.goto('/expeditions/history')
    await waitForMockRuntime(page)
    await page.evaluate(() => {
      const runtime = window.__galaxifyMock
      if (runtime === undefined) throw new Error('Mock runtime is unavailable')
      const { backend } = runtime
      const getShip = backend.getShip.bind(backend)
      backend.getShip = (token) => ({ ...getShip(token), materials_balance: 330 })
    })
    await page.getByRole('link', { name: /Success/ }).click()
    const panel = page.getByRole('region', { name: 'Expedition resolved' })
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Success')).toBeVisible()
    await expect(panel.getByText('+80 materials')).toBeVisible()
    await expect(panel.getByText('Investment')).toBeVisible()
    await expect(panel.getByText('Chance at launch')).toBeVisible()
    await expect(panel.getByText('Update delayed')).toBeVisible({ timeout: 12_000 })
    await expect(panel.getByText(/Available materials: 330/)).toBeVisible()
    await expectAccessibleReflow(page)
    await expect(page).toHaveScreenshot('expedition-resolved-success-1440.png', {
      fullPage: true,
    })
  })

  test('resolved detail shows the typed Failed outcome and zero reward at 390x844', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.clock.setFixedTime(EPOCH)
    await seedAuthenticated(page)
    await page.goto('/expeditions/history')
    await page.getByRole('link', { name: /Failed/ }).click()
    const panel = page.getByRole('region', { name: 'Expedition resolved' })
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Failed')).toBeVisible()
    await expect(panel.getByText('0 materials', { exact: true })).toBeVisible()
    await expect(panel.getByText('Investment')).toBeVisible()
    await expect(panel.getByText('Update delayed')).toBeVisible({ timeout: 12_000 })
    await expectAccessibleReflow(page)
    await expect(page).toHaveScreenshot('expedition-resolved-failure-390.png', { fullPage: true })
  })

  test('a delayed result keeps confirmed facts with a local Retry at 320x700', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await seedAuthenticated(page)
    await page.goto('/expeditions/history')
    await expect(page.getByRole('heading', { name: 'Expedition history' })).toBeVisible()
    await page.evaluate(() => {
      const runtime = window.__galaxifyMock
      if (runtime === undefined) throw new Error('Mock runtime is unavailable')
      const { backend } = runtime
      const getExpedition = backend.getExpedition.bind(backend)
      backend.getExpedition = (token, id) => {
        const expedition = getExpedition(token, id)
        const missing = { ...expedition }
        delete missing.result
        return missing
      }
    })
    await page.getByRole('link', { name: /Success/ }).click()
    const panel = page.getByRole('region', { name: 'Confirming your result' })
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Update delayed')).toBeVisible({ timeout: 12_000 })
    await expect(panel.getByText('Investment')).toBeVisible()
    await expect(panel.getByText('40 materials')).toBeVisible()
    await expect(panel.getByText('Chance at launch')).toBeVisible()
    await expect(panel.getByText('62%')).toBeVisible()
    await expect(panel.getByText('Launched')).toBeVisible()
    await expect(panel.getByText('Resolves')).toBeVisible()
    await expect(panel.getByText('Success')).toHaveCount(0)
    await expect(panel.getByText('+80 materials')).toHaveCount(0)
    await expectAccessibleReflow(page)
    await expect(page).toHaveScreenshot('expedition-result-delayed-320.png', { fullPage: true })
  })

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 320, height: 700 },
  ] as const) {
    test(`history rows reflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.clock.setFixedTime(EPOCH)
      await seedAuthenticated(page)
      await page.goto('/expeditions/history')
      await expect(page.getByRole('heading', { name: 'Expedition history' })).toBeVisible()
      await expect(page.getByRole('link', { name: /Success/ })).toBeVisible()
      await expect(page.getByRole('link', { name: /Failed/ })).toBeVisible()
      await expectAccessibleReflow(page)
      await expect(page).toHaveScreenshot(`expedition-history-${viewport.width}.png`, {
        fullPage: true,
      })
    })
  }

  test('a malformed Expedition id recovers locally inside the shell at 320x700', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await page.clock.setFixedTime(EPOCH)
    await seedAuthenticated(page)
    await page.goto('/expeditions/not-a-uuid')
    await expect(page.getByRole('heading', { name: 'Expedition not found' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Expeditions' })).toHaveAttribute(
      'href',
      '/expeditions',
    )
    await expectAccessibleReflow(page)
    await expect(page).toHaveScreenshot('expedition-notfound-320.png', { fullPage: true })
  })

  test('launch planning holds at the 720x450 zoom proxy', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 450 })
    await page.clock.setFixedTime(EPOCH)
    await seedAuthenticated(page)
    await page.goto('/expeditions')
    await expect(page.getByRole('region', { name: 'Launch an Expedition' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Ship status' })).toBeVisible()
    await page.getByLabel('Materials to invest').fill('40')
    await expect(page.getByText('Ready to launch.')).toBeVisible()
    await expectAccessibleReflow(page)
    await expect(page).toHaveScreenshot('expedition-zoom-720x450.png', { fullPage: true })
  })

  test('reduced motion leaves no running animations on Expedition routes', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.clock.setFixedTime(EPOCH)
    await seedAuthenticated(page)
    await page.goto('/expeditions')
    await expect(page.getByRole('region', { name: 'Launch an Expedition' })).toBeVisible()
    await page.goto(`/expeditions/${RESOLVED_SUCCESS_ID}`)
    await expect(page.getByRole('region', { name: 'Expedition resolved' })).toBeVisible()
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
      true,
    )
    expect(
      await page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === 'running').length,
      ),
    ).toBe(0)
  })

  test('initial loading keeps the shell chrome while Expedition facts resolve at 390x844', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.clock.setFixedTime(EPOCH)
    await seedAuthenticated(page)
    await page.goto('/expeditions/history')
    await waitForMockRuntime(page)
    await expect(page.getByRole('heading', { name: 'Expedition history' })).toBeVisible()
    await page.evaluate(() => {
      const runtime = window.__galaxifyMock
      if (runtime === undefined) throw new Error('Mock runtime is unavailable')
      Object.assign(runtime.backend, { responseDelayMs: 2400 })
    })
    await page.getByRole('link', { name: 'Overview' }).click()
    await expect(page.getByRole('status', { name: 'Loading content' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Galaxify' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible()
    await expect(page).toHaveScreenshot('expedition-loading-390.png')
    await page.evaluate(() => {
      Object.assign(window.__galaxifyMock?.backend ?? {}, { responseDelayMs: 120 })
    })
    await expect(page.getByRole('region', { name: 'Launch an Expedition' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Ship status' })).toBeVisible()
  })

  test('a not-ready Expedition read shows Preparing with an explicit Retry at 768x1024', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.clock.setFixedTime(EPOCH)
    await seedAuthenticated(page)
    await page.goto('/expeditions/history')
    await waitForMockRuntime(page)
    await page.evaluate(() => {
      const runtime = window.__galaxifyMock
      if (runtime === undefined) throw new Error('Mock runtime is unavailable')
      const { backend } = runtime
      let mockError: (new (status: number, code: string, message: string) => Error) | undefined
      try {
        backend.getShip('not-a-session-token')
      } catch (error) {
        mockError = (error as Error).constructor as typeof mockError
      }
      if (mockError === undefined) {
        throw new Error('MockApiError constructor was not captured')
      }
      backend.getCurrentExpedition = () => {
        throw new mockError(503, 'EXPEDITION_SHIP_STATE_NOT_READY', 'Not ready yet.')
      }
    })
    await page.getByRole('link', { name: 'Overview' }).click()
    const panel = page.getByRole('region', { name: 'Preparing your Expedition' })
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Preparing…')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Retry' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Ship status' })).toBeVisible()
    await expectAccessibleReflow(page)
    await expect(page).toHaveScreenshot('expedition-preparing-768.png', { fullPage: true })
  })

  test('an unavailable Expedition read recovers through a keyboard Retry at 390x844', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.clock.setFixedTime(EPOCH)
    await seedAuthenticated(page)
    await page.goto('/expeditions/history')
    await waitForMockRuntime(page)
    await page.evaluate(() => {
      const runtime = window.__galaxifyMock
      if (runtime === undefined) throw new Error('Mock runtime is unavailable')
      const { backend } = runtime
      let mockError: (new (status: number, code: string, message: string) => Error) | undefined
      try {
        backend.getShip('not-a-session-token')
      } catch (error) {
        mockError = (error as Error).constructor as typeof mockError
      }
      if (mockError === undefined) {
        throw new Error('MockApiError constructor was not captured')
      }
      const original = backend.getCurrentExpedition.bind(backend)
      window.__expeditionUnavailable = true
      backend.getCurrentExpedition = (token) => {
        if (window.__expeditionUnavailable === true) {
          throw new mockError(500, 'INTERNAL_ERROR', 'Boom.')
        }
        return original(token)
      }
    })
    await page.getByRole('link', { name: 'Overview' }).click()
    await expect(page.getByText('Expeditions are unavailable')).toBeVisible()
    const retry = page
      .locator('section', { has: page.getByText('Expeditions are unavailable') })
      .getByRole('button', { name: 'Retry' })
    await expect(retry).toBeVisible()
    await expectAccessibleReflow(page)
    await expect(page).toHaveScreenshot('expedition-unavailable-390.png', { fullPage: true })

    await page.evaluate(() => {
      window.__expeditionUnavailable = false
    })
    await retry.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('region', { name: 'Launch an Expedition' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Ship status' })).toBeVisible()
  })

  test('a failed launch revalidation withholds the command and offers a quote Retry at 390x844', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.clock.setFixedTime(EPOCH)
    await seedAuthenticated(page)
    await page.goto('/expeditions/history')
    await waitForMockRuntime(page)
    await page.evaluate(() => {
      const runtime = window.__galaxifyMock
      if (runtime === undefined) throw new Error('Mock runtime is unavailable')
      const { backend } = runtime
      let mockError: (new (status: number, code: string, message: string) => Error) | undefined
      try {
        backend.getShip('not-a-session-token')
      } catch (error) {
        mockError = (error as Error).constructor as typeof mockError
      }
      if (mockError === undefined) {
        throw new Error('MockApiError constructor was not captured')
      }
      backend.getExpeditionQuote = () => {
        throw new mockError(500, 'INTERNAL_ERROR', 'Boom.')
      }
    })
    await page.getByRole('link', { name: 'Overview' }).click()
    await page.getByLabel('Materials to invest').fill('40')
    await expect(page.getByText('We could not load a quote. Try again.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Launch Expedition' })).toBeDisabled()
    await expect(page.getByText('Ready to launch.')).toHaveCount(0)
    await expectAccessibleReflow(page)
    await expect(page).toHaveScreenshot('expedition-quote-error-390.png', { fullPage: true })
  })

  test('a repeated launch click during revalidation issues one command at 1440x900', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.clock.setFixedTime(EPOCH)
    await seedAuthenticated(page)
    await page.goto('/expeditions')
    await page.getByLabel('Materials to invest').fill('40')
    await expect(page.getByText('Ready to launch.')).toBeVisible()

    await page.evaluate(() => {
      const runtime = window.__galaxifyMock
      if (runtime === undefined) throw new Error('Mock runtime is unavailable')
      const { backend } = runtime
      window.__launchCalls = 0
      window.__holdResponses = true
      window.__responseReleasers = []
      const launch = backend.launchExpedition.bind(backend)
      backend.launchExpedition = (token, body) => {
        window.__launchCalls = (window.__launchCalls ?? 0) + 1
        return launch(token, body)
      }
      backend.awaitResponseDelay = () =>
        window.__holdResponses === true
          ? new Promise<void>((resolve) => {
              window.__responseReleasers?.push(resolve)
            })
          : Promise.resolve()
    })
    await page.getByRole('button', { name: 'Launch Expedition' }).click()
    const working = page.getByRole('button', { name: 'Working…' })
    await expect(working).toBeVisible()
    await expect(working).toBeDisabled()
    await expect(page.getByText('Ready to launch.')).toHaveCount(0)
    await working.dispatchEvent('click')
    await page.waitForTimeout(300)
    await expect.poll(async () => page.evaluate(() => window.__launchCalls ?? 0)).toBe(0)

    await page.evaluate(() => {
      window.__holdResponses = false
      for (const release of window.__responseReleasers ?? []) {
        release()
      }
    })
    await expect(page.getByRole('heading', { name: 'Expedition in flight' })).toBeVisible({
      timeout: 10_000,
    })
    await expect.poll(async () => page.evaluate(() => window.__launchCalls ?? 0)).toBe(1)
  })
})
