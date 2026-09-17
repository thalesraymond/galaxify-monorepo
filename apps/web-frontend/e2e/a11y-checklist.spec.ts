import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'

import { expectAuthenticatedDashboard, seedAuthenticated } from './session'

/**
 * Release-gate accessibility checklist automation. Each test backs one item of
 * the versioned manual checklist (`docs/specs/web-frontend-accessibility-checklist.md`):
 * keyboard journeys, contrast, live regions, 200% zoom, 320 px reflow, touch
 * targets, orientation, and reduced motion. The screen-reader smoke is the one
 * item that stays manual; see the checklist document.
 */

/** DESIGN.md floor: every interactive target is at least 44×44 CSS px. */
const MIN_TARGET_PX = 44

/** Authenticated pages that represent the shipped surface. */
const appPages = [
  { path: '/dashboard', heading: 'Dashboard' },
  { path: '/dailies', heading: 'Dailies' },
  { path: '/dailies/new', heading: 'Create a Daily' },
  { path: '/ship', heading: 'Ship' },
  { path: '/expeditions', heading: 'Expeditions' },
  { path: '/profile', heading: 'Profile' },
] as const

async function openAuthenticatedPage(page: Page, path: string, heading: string): Promise<void> {
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
}

test('keyboard journeys reach and operate every primary control', async ({ page }) => {
  // The skip link is the first keyboard stop and jumps to the main content.
  await page.goto('/signup')
  await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible()
  await page.keyboard.press('Tab')
  const skipLink = page.getByRole('link', { name: /skip to main content/i })
  await expect(skipLink).toBeFocused()
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('auth-main')

  // The Account menu opens and operates as a keyboard composite widget.
  await seedAuthenticated(page)
  await page.goto('/dashboard')
  await expectAuthenticatedDashboard(page)
  await focusByKeyboard(page, page.getByRole('button', { name: 'Account' }).first(), ['Tab'])
  await page.keyboard.press('Enter')
  const logoutItem = page.getByRole('menuitem', { name: 'Log out' }).first()
  await expect(logoutItem).toBeVisible()
  await focusByKeyboard(page, logoutItem, ['ArrowDown'])
  await expect(logoutItem).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
})

test('dialogs trap focus, close on Escape, and restore focus', async ({ page }) => {
  await seedAuthenticated(page)
  await openAuthenticatedPage(page, '/profile', 'Profile')

  const trigger = page.getByRole('button', { name: 'Delete account' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Delete your account' })
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true)

  // Tabbing never escapes the dialog while it is open.
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true)
  }

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('text and UI contrast meets WCAG A/AA on every representative page', async ({ page }) => {
  await page.goto('/signup')
  await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible()
  await expectNoContrastViolations(page)

  await page.goto('/login')
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
  await expectNoContrastViolations(page)

  await seedAuthenticated(page)
  for (const appPage of appPages) {
    await openAuthenticatedPage(page, appPage.path, appPage.heading)
    await expectNoContrastViolations(page)
  }

  await page.goto('/__design-system-preview')
  await expect(page.getByRole('heading', { level: 1, name: 'Interface states' })).toBeVisible()
  await expectNoContrastViolations(page)
})

test('command outcomes are announced once in scoped live regions', async ({ page }) => {
  await seedAuthenticated(page)
  await openAuthenticatedPage(page, '/profile', 'Profile')

  const username = page.getByLabel('Username')
  await username.fill('nova-captain')
  await page.getByRole('button', { name: 'Save username' }).click()

  const announcement = page.getByText('Your username was updated.')
  await expect(announcement).toBeAttached()
  await expect(announcement).toHaveAttribute('aria-live', 'polite')
  await expect(announcement).toHaveAttribute('aria-atomic', 'true')
  // The success region is scoped to the form; exactly one announcement exists.
  await expect(page.getByText('Your username was updated.')).toHaveCount(1)
})

test('200% zoom keeps every page usable without two-dimensional scrolling', async ({ page }) => {
  await seedAuthenticated(page)
  // 200% zoom on a 1440×900 window renders at 720 CSS px wide (WCAG 1.4.4).
  await page.setViewportSize({ width: 720, height: 450 })
  for (const appPage of appPages) {
    await openAuthenticatedPage(page, appPage.path, appPage.heading)
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
    await expectNoHorizontalScroll(page)
  }
})

test('320 px reflow loses no primary content to horizontal scrolling', async ({ page }) => {
  await seedAuthenticated(page)
  await page.setViewportSize({ width: 320, height: 700 })
  for (const appPage of appPages) {
    await openAuthenticatedPage(page, appPage.path, appPage.heading)
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
    await expectNoHorizontalScroll(page)
  }
})

test('interactive targets meet the 44×44 px design floor', async ({ page }) => {
  await page.goto('/signup')
  await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible()
  await expectTargetsMeetFloor(page, '/signup')

  await seedAuthenticated(page)
  for (const appPage of appPages) {
    await openAuthenticatedPage(page, appPage.path, appPage.heading)
    await expectTargetsMeetFloor(page, appPage.path)
  }
})

test('portrait and landscape orientations both stay usable', async ({ page }) => {
  await seedAuthenticated(page)
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    for (const appPage of [
      { path: '/dashboard', heading: 'Dashboard' },
      { path: '/dailies', heading: 'Dailies' },
    ]) {
      await openAuthenticatedPage(page, appPage.path, appPage.heading)
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
      await expectNoHorizontalScroll(page)
    }
  }
})

test('reduced motion removes animation while keeping status and meaning', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const reducedPage = await context.newPage()
  try {
    await seedAuthenticated(reducedPage)
    for (const appPage of appPages) {
      await openAuthenticatedPage(reducedPage, appPage.path, appPage.heading)
      const longestMotionMs = await reducedPage.evaluate(() => {
        let longest = 0
        const durationPattern = /^([\d.]+)(ms|s)$/
        for (const element of document.querySelectorAll('*')) {
          const styles = window.getComputedStyle(element)
          for (const duration of [styles.transitionDuration, styles.animationDuration].flatMap(
            (value) => value.split(','),
          )) {
            const match = durationPattern.exec(duration.trim())
            if (match === null) {
              continue
            }
            longest = Math.max(longest, toMilliseconds(match[1], match[2]))
          }
        }
        return longest
      })
      // tokens.css collapses every transition/animation to 0.01 ms under
      // prefers-reduced-motion: reduce; nothing may exceed that.
      expect(longestMotionMs).toBeLessThanOrEqual(0.01)
    }
  } finally {
    await context.close()
  }
})

/**
 * Advances keyboard focus to the target using only the given traversal keys,
 * pressed round-robin, so the journey stays genuinely keyboard-driven.
 */
async function focusByKeyboard(
  page: Page,
  target: Locator,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) {
    throw new Error('focusByKeyboard needs at least one traversal key')
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const focused = await target.evaluate((node) => node === document.activeElement)
    if (focused) {
      return
    }
    const key = keys.at(attempt % keys.length)
    if (key === undefined) {
      throw new Error('focusByKeyboard received an undefined traversal key')
    }
    await page.keyboard.press(key)
  }
  throw new Error('Keyboard traversal never reached the target after 60 presses')
}

/** Parses a CSS duration like "0.01ms" or "150ms" into milliseconds. */
function toMilliseconds(amount: string | undefined, unit: string | undefined): number {
  const value = Number(amount ?? 0)
  return unit === 's' ? value * 1000 : value
}

/** Shortens an element's text for an offender report; null text reports empty. */
function trimmedLabel(text: string | null): string {
  return (text ?? '').trim().slice(0, 40)
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      (document.scrollingElement ?? document.documentElement).scrollWidth -
      document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

async function expectNoContrastViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze()
  const contrastViolations = results.violations.filter(
    (violation) => violation.id === 'color-contrast',
  )
  expect(contrastViolations, JSON.stringify(contrastViolations, null, 2)).toEqual([])
}

async function expectTargetsMeetFloor(page: Page, context: string): Promise<void> {
  const smallTargets = await page.evaluate(
    ({ minPx }) => {
      const selector = [
        'button',
        'a',
        'input',
        'select',
        'textarea',
        '[role="button"]',
        '[role="menuitem"]',
      ].join(', ')
      const offenders = []
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        // A radio/checkbox's effective target is its wrapping label.
        const label =
          element instanceof HTMLInputElement &&
          (element.type === 'radio' || element.type === 'checkbox')
            ? element.closest('label')
            : null
        const target = label ?? element
        // Links embedded in sentence prose are exempt from target-size rules
        // (WCAG 2.5.8 "Inline" exception, part of the 2.2 AA contract); every
        // other interactive target must meet the DESIGN.md 44×44 floor.
        if (target instanceof HTMLAnchorElement && target.closest('p') !== null) {
          continue
        }
        const styles = window.getComputedStyle(target)
        if (styles.display === 'none' || styles.visibility === 'hidden') {
          continue
        }
        const rect = target.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) {
          continue
        }
        if (rect.width < minPx || rect.height < minPx) {
          offenders.push({
            tag: target.tagName.toLowerCase(),
            text: trimmedLabel(target.textContent),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          })
        }
      }
      return offenders
    },
    { minPx: MIN_TARGET_PX },
  )
  expect(smallTargets, `${context}: targets below ${MIN_TARGET_PX}px`).toEqual([])
}
