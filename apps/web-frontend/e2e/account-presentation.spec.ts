import { expect, test, type Locator, type Page } from '@playwright/test'

import { seedAuthenticated, waitForMockRuntime } from './session'

test.use({ timezoneId: 'UTC' })

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'reflow', width: 320, height: 700 },
] as const

const stackedViewports = [
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'reflow', width: 320, height: 700 },
] as const

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0)
}

async function expectFocusInsideDialog(page: Page) {
  const dialog = page.getByRole('dialog')
  expect(await dialog.evaluate((node) => node.contains(node.ownerDocument.activeElement))).toBe(
    true,
  )
}

/**
 * Returns the bounding box of a visible control, failing the test when the
 * element is hidden or detached.
 */
async function requireBox(locator: Locator) {
  const box = await locator.boundingBox()
  if (box === null) {
    throw new Error('expected a bounding box — the element is hidden or detached')
  }
  return box
}

/**
 * Keyboard-focus the control after the password input and return its computed
 * focus ring. The shared focus vocabulary is a 3px sky-blue outline with a 4px
 * offset (`frontend-redesign.md` §2).
 */
async function readFocusRingAfterTab(page: Page) {
  await page.keyboard.press('Tab')
  return page.evaluate(() => {
    const element = document.activeElement
    if (!(element instanceof HTMLElement)) {
      throw new Error('expected a focused element')
    }
    const style = getComputedStyle(element)
    return {
      name: element.textContent,
      width: style.outlineWidth,
      offset: style.outlineOffset,
      color: style.outlineColor,
    }
  })
}

test.describe('account form presentation', () => {
  for (const viewport of viewports) {
    test(`signup form geometry and controls at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/signup')
      await waitForMockRuntime(page)
      const heading = page.getByRole('heading', { level: 1, name: 'Create your account' })
      await expect(heading).toBeVisible()

      // The heading sits above the charcoal form panel on the page ground, and
      // the panel spans the available width up to the 760px account-form cap.
      const form = page.locator('main form')
      const headingBox = await requireBox(heading)
      const formBox = await requireBox(form)
      expect(headingBox.y + headingBox.height).toBeLessThanOrEqual(formBox.y)
      expect(await form.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
        'rgb(17, 17, 17)',
      )
      expect(formBox.width).toBeLessThanOrEqual(760)
      if (viewport.width > 850) {
        expect(formBox.width).toBeGreaterThan(700)
      }

      // The primary submit keeps intrinsic width instead of stretching.
      const submitBox = await requireBox(page.getByRole('button', { name: 'Create account' }))
      expect(submitBox.width).toBeLessThan(formBox.width - 48)

      // The cross-link target is at least 44px tall with 8px separation.
      const crossLinkBox = await requireBox(page.getByRole('link', { name: 'Sign in' }))
      expect(crossLinkBox.height).toBeGreaterThanOrEqual(44)
      expect(crossLinkBox.y - (submitBox.y + submitBox.height)).toBeGreaterThanOrEqual(8)

      // Show/hide password keeps the value and stays a >=44px target with the
      // shared 3px sky-blue focus ring. The locator matches both label states
      // so the same element can be exercised across the roundtrip.
      const password = page.getByLabel('Password')
      await password.fill('password123')
      const toggle = page.getByRole('button', { name: /password/i })
      await expect(toggle).toHaveAccessibleName('Show password')
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      const toggleBox = await requireBox(toggle)
      expect(toggleBox.height).toBeGreaterThanOrEqual(44)
      expect(toggleBox.width).toBeGreaterThanOrEqual(44)
      const ring = await readFocusRingAfterTab(page)
      expect(ring.name).toMatch(/password/i)
      expect(ring.width).toBe('3px')
      expect(ring.offset).toBe('4px')
      expect(ring.color).toBe('rgb(101, 189, 233)')
      await toggle.click()
      await expect(toggle).toHaveAccessibleName('Hide password')
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      await expect(password).toHaveAttribute('type', 'text')
      await expect(password).toHaveValue('password123')

      await expectNoHorizontalOverflow(page)
      await expect(page).toHaveScreenshot(`signup-${viewport.name}.png`, { fullPage: true })

      // Hiding again restores the masked input without losing the draft.
      await toggle.click()
      await expect(toggle).toHaveAccessibleName('Show password')
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await expect(password).toHaveAttribute('type', 'password')
      await expect(password).toHaveValue('password123')
    })

    test(`login form geometry and controls at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/login')
      await waitForMockRuntime(page)
      const heading = page.getByRole('heading', { level: 1, name: 'Sign in' })
      await expect(heading).toBeVisible()

      const form = page.locator('main form')
      const headingBox = await requireBox(heading)
      const formBox = await requireBox(form)
      expect(headingBox.y + headingBox.height).toBeLessThanOrEqual(formBox.y)
      expect(await form.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
        'rgb(17, 17, 17)',
      )
      expect(formBox.width).toBeLessThanOrEqual(760)
      if (viewport.width > 850) {
        expect(formBox.width).toBeGreaterThan(700)
      }

      const submitBox = await requireBox(page.getByRole('button', { name: 'Sign in' }))
      expect(submitBox.width).toBeLessThan(formBox.width - 48)

      const crossLinkBox = await requireBox(page.getByRole('link', { name: 'Create an account' }))
      expect(crossLinkBox.height).toBeGreaterThanOrEqual(44)
      expect(crossLinkBox.y - (submitBox.y + submitBox.height)).toBeGreaterThanOrEqual(8)

      const toggle = page.getByRole('button', { name: /password/i })
      const toggleBox = await requireBox(toggle)
      expect(toggleBox.height).toBeGreaterThanOrEqual(44)

      await expectNoHorizontalOverflow(page)
      await expect(page).toHaveScreenshot(`login-${viewport.name}.png`, { fullPage: true })

      // Show/hide roundtrip on login preserves the value and aria-pressed.
      const loginPassword = page.getByLabel('Password')
      await loginPassword.fill('password123')
      await expect(toggle).toHaveAccessibleName('Show password')
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await toggle.click()
      await expect(toggle).toHaveAccessibleName('Hide password')
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      await expect(loginPassword).toHaveAttribute('type', 'text')
      await expect(loginPassword).toHaveValue('password123')
      await toggle.click()
      await expect(toggle).toHaveAccessibleName('Show password')
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await expect(loginPassword).toHaveAttribute('type', 'password')
      await expect(loginPassword).toHaveValue('password123')
      await expectNoHorizontalOverflow(page)
    })
  }
})

test.describe('Profile presentation', () => {
  test('sections span the frame on desktop and stack below 850px', async ({ page }) => {
    await seedAuthenticated(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/profile')
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()

    const identity = page.getByRole('region', { name: 'Identity' })
    const danger = page.getByRole('region', { name: 'Danger zone' })
    const identityBox = await requireBox(identity)
    const dangerBox = await requireBox(danger)
    // Side-by-side tracks: identity on the wider 1.4fr column, danger to its right.
    expect(dangerBox.x).toBeGreaterThanOrEqual(identityBox.x + identityBox.width)
    expect(Math.abs(identityBox.y - dangerBox.y)).toBeLessThan(4)
    expect(identityBox.width).toBeGreaterThan(dangerBox.width)
    await expectNoHorizontalOverflow(page)

    for (const narrow of stackedViewports) {
      await page.setViewportSize(narrow)
      const stackedIdentity = await requireBox(identity)
      const stackedDanger = await requireBox(danger)
      expect(stackedDanger.y).toBeGreaterThanOrEqual(stackedIdentity.y + stackedIdentity.height - 1)
      await expectNoHorizontalOverflow(page)
    }
  })

  test('a long unbroken email wraps at reflow width', async ({ page }) => {
    const longEmail = 'a-very-long-unbroken-player-email-address-for-reflow@example.test'
    await page.addInitScript((email) => {
      const nativeFetch = window.fetch.bind(window)
      window.fetch = async (input, init) => {
        const request = new Request(input, init)
        if (request.method === 'GET' && new URL(request.url).pathname === '/api/user/users/me') {
          const response = await nativeFetch(input, init)
          const body = (await response.json()) as Record<string, unknown>
          return Response.json({ ...body, email }, { status: response.status })
        }
        return nativeFetch(input, init)
      }
    }, longEmail)
    await seedAuthenticated(page)
    await page.setViewportSize({ width: 320, height: 700 })
    await page.goto('/profile')
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()

    const email = page.getByText(longEmail)
    await expect(email).toBeVisible()
    expect(await email.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    await expectNoHorizontalOverflow(page)
    await expect(page).toHaveScreenshot('profile-long-email-reflow.png', { fullPage: true })
  })

  test('deletion dialog traps focus, scrolls, restores, and retries at reflow', async ({
    page,
  }) => {
    // Unbroken 30-character username — the maximum the field accepts — so the
    // wrapping stays within the real schema bound.
    const longUsername = 'playerusername1234567890123456'
    await page.addInitScript((username) => {
      const nativeFetch = window.fetch.bind(window)
      let rejectedOnce = false
      window.fetch = async (input, init) => {
        const request = new Request(input, init)
        const pathname = new URL(request.url).pathname
        if (request.method === 'GET' && pathname === '/api/user/users/me') {
          const response = await nativeFetch(input, init)
          const body = (await response.json()) as Record<string, unknown>
          return Response.json({ ...body, username }, { status: response.status })
        }
        if (!rejectedOnce && request.method === 'DELETE' && pathname === '/api/user/users/me') {
          rejectedOnce = true
          return Response.json(
            { error: { code: 'USER_INVALID_CREDENTIALS', message: 'Password is incorrect.' } },
            { status: 401 },
          )
        }
        return nativeFetch(input, init)
      }
    }, longUsername)
    await seedAuthenticated(page)
    // Short viewport: the dialog content must scroll internally at 85dvh.
    const viewport = { width: 320, height: 400 }
    await page.setViewportSize(viewport)
    await page.goto('/profile')
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()

    const trigger = page.getByRole('button', { name: 'Delete account', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Delete your account' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Password')).toBeFocused()

    // The dialog element itself is the internal scroller: its content
    // overflows the 85dvh max-height while overflow-y stays auto.
    const dialogMetrics = await dialog.evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        overflowY: style.overflowY,
      }
    })
    expect(dialogMetrics.overflowY).toBe('auto')
    expect(dialogMetrics.scrollHeight).toBeGreaterThan(dialogMetrics.clientHeight)
    expect(dialogMetrics.clientHeight).toBeLessThanOrEqual(Math.ceil(viewport.height * 0.85))

    // Tab and Shift+Tab stay inside the dialog, wrapping at both edges.
    for (let press = 0; press < 4; press += 1) {
      await page.keyboard.press('Tab')
      await expectFocusInsideDialog(page)
    }
    const close = dialog.getByRole('button', { name: 'Close dialog' })
    const confirm = dialog.getByRole('button', { name: 'Delete account', exact: true })
    const cancel = dialog.getByRole('button', { name: 'Cancel' })
    const password = dialog.getByLabel('Password')
    await password.focus()
    await page.keyboard.press('Shift+Tab')
    await expect(close).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(confirm).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(close).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(password).toBeFocused()

    // Every control remains reachable inside the scrollable dialog.
    await confirm.scrollIntoViewIfNeeded()
    await expect(confirm).toBeInViewport()
    await cancel.scrollIntoViewIfNeeded()
    await expect(cancel).toBeInViewport()
    await expectNoHorizontalOverflow(page)

    // Escape closes the dialog and returns focus to the trigger.
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeFocused()

    // A rejected deletion keeps the draft and refocuses the password; the
    // retry then completes the deletion and lands on signup.
    await trigger.click()
    const retryDialog = page.getByRole('dialog', { name: 'Delete your account' })
    await expect(retryDialog).toBeVisible()
    const retryPassword = retryDialog.getByLabel('Password')
    await retryPassword.fill('password123')
    await retryDialog.getByRole('button', { name: 'Delete account', exact: true }).click()
    await expect(retryDialog.getByText('Password is incorrect.')).toBeVisible()
    await expect(retryPassword).toHaveValue('password123')
    await expect(retryPassword).toBeFocused()
    await retryDialog.getByRole('button', { name: 'Delete account', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible()
  })
})
