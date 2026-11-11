// Disposable synthetic UI evidence; run against prototype:convergence:preview.
import { chromium } from 'playwright'
import { expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const base = process.env.PROTOTYPE_URL ?? 'http://127.0.0.1:4321'
const directory =
  process.env.PROTOTYPE_EVIDENCE_DIR ?? 'prototype-convergence/evidence/cross-frontend'
await mkdir(directory, { recursive: true })
const browser = await chromium.launch()
const results = []
const routes = [
  ['/', 'Dashboard'],
  ['/?session=anonymous', 'Create your account'],
  ['/login?session=signed-in', 'Dashboard'],
  ['/dashboard', 'Dashboard'],
  ['/dailies', 'Dailies'],
  ['/dailies/history', 'Daily History'],
  ['/dailies/new', 'Create Daily'],
  ['/dailies/walk/edit', 'Edit Daily'],
  ['/signup', 'Create your account'],
  ['/login', 'Sign in'],
  ['/profile', 'Profile'],
  ['/ship', 'Ship'],
  ['/expeditions', 'Expeditions'],
  ['/expeditions/history', 'Expedition history'],
  ['/expeditions/sample-success', 'Expedition result'],
  ['/expeditions/sample-failure', 'Expedition result'],
  ['/expeditions/sample-flight', 'Expedition result'],
  ['/expeditions/sample-delayed', 'Expedition result'],
  ['/unknown', 'Page not found'],
  ['/dailies/missing/edit', 'Page not found'],
  ['/expeditions/missing', 'Page not found'],
  ['/__design-system-preview', 'Prototype unavailable'],
]

async function check(page, name) {
  assert.equal(
    await page.locator('#prototype-surface').evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
    `${name}: app overflow`,
  )
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${name}: document overflow`,
  )
  const { violations } = await new AxeBuilder({ page }).analyze()
  assert.deepEqual(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target)}`),
    [],
    name,
  )
}

async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready)
  const surface = page.locator('#prototype-surface')
  const { height, viewport } = await surface.evaluate((el) => ({
    height: el.scrollHeight,
    viewport: el.clientHeight,
  }))
  for (let offset = 0, part = 1; offset < height; offset += viewport - 60, part++) {
    await surface.evaluate((el, top) => {
      el.scrollTop = top
    }, offset)
    await page.evaluate(() => new Promise(requestAnimationFrame))
    await page.screenshot({ path: `${directory}/${name}${part === 1 ? '' : `-part-${part}`}.png` })
    if (offset + viewport >= height) break
  }
  await surface.evaluate((el) => {
    el.scrollTop = 0
  })
}

async function primaryNavigation(page, name) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  if (await menu.isVisible()) await menu.click()
  await page
    .getByRole('navigation', { name: 'Primary', exact: true })
    .filter({ visible: true })
    .getByRole('link', { name, exact: true })
    .click()
}

try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    for (const [path, heading] of routes) {
      await page.goto(base + path)
      await expect(
        page.getByRole('heading', { name: heading, level: 1, exact: true }),
      ).toBeVisible()
      await check(page, `${path}/${width}`)
      if (
        [320, 1440].includes(width) &&
        ['/signup', '/profile', '/expeditions/history', '/expeditions/sample-delayed'].includes(
          path,
        )
      )
        await capture(page, `${path.slice(1).replaceAll('/', '-')}-${width}`)
    }
    for (const [path, sample, text] of [
      ['/dailies/history', 'empty', 'No Daily outcomes yet'],
      ['/dailies/history', 'loading', 'Loading Daily History…'],
      ['/ship', 'preparing', 'Preparing your Ship'],
      ['/ship', 'error', 'Ship is unavailable'],
      ['/profile', 'loading', 'Loading Profile…'],
      ['/profile', 'long', 'Identity'],
      [
        '/dailies',
        'long',
        'Make time to read, reflect, and write a thoughtful note before the end of a very full day',
      ],
      ['/dailies/history', 'long', 'Preserved Daily outcomes'],
      ['/expeditions/history', 'empty', 'No Expeditions yet.'],
      ['/expeditions/history', 'error', 'Expedition history is unavailable.'],
      [
        '/expeditions/sample-success',
        'stale',
        'Last confirmed facts shown. Refresh failed; spending is paused.',
      ],
    ]) {
      await page.goto(`${base}${path}?sample=${sample}`)
      await expect(page.getByText(text, { exact: sample !== 'stale' })).toBeVisible()
      await check(page, `${path}/${sample}/${width}`)
      if (width === 320 && ['long', 'preparing', 'stale'].includes(sample))
        await capture(page, `${path.slice(1).replaceAll('/', '-')}-${sample}-${width}`)
    }
    for (const boundary of ['bootstrap', 'loading', 'error']) {
      await page.goto(`${base}/dashboard?boundary=${boundary}`)
      await check(page, `boundary/${boundary}/${width}`)
      await page
        .getByRole('button', {
          name: boundary === 'error' ? 'Retry page' : 'Finish sample loading',
        })
        .click()
      await expect(page.getByRole('heading', { name: 'Today’s Dailies' })).toBeVisible()
    }
    // Anonymous deep link returns to its protected destination after synthetic sign-in.
    await page.goto(`${base}/ship?session=anonymous`)
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
    await page.getByLabel('Email', { exact: true }).fill('rowan@example.test')
    await page.getByLabel('Password', { exact: true }).fill('made-up-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Connecting…' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Ship', exact: true })).toBeVisible()
    await page.goto(`${base}/dailies?session=anonymous&date=2026-01-14&status=completed`)
    await page.getByLabel('Email', { exact: true }).fill('rowan@example.test')
    await page.getByLabel('Password', { exact: true }).fill('made-up-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: 'Dailies', exact: true }),
    ).toBeVisible()
    assert.equal(new URL(page.url()).searchParams.get('date'), '2026-01-14')
    assert.equal(new URL(page.url()).searchParams.get('status'), 'completed')
    // Error retains input; retry changes only the synthetic response.
    await page.goto(`${base}/login?sample=error`)
    await page.getByLabel('Email', { exact: true }).fill('rowan@example.test')
    await page.getByLabel('Password', { exact: true }).fill('made-up-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('did not match')
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('rowan@example.test')
    await page.getByRole('button', { name: 'Retry authentication' }).click()
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
    // Native dialog traps focus, closes on Escape and restores its trigger.
    await page.goto(`${base}/profile`)
    const trigger = page.getByRole('button', { name: 'Delete account', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Password')).toBeFocused()
    if ([320, 1440].includes(width)) await capture(page, `profile-dialog-${width}`)
    await check(page, `dialog/${width}`)
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Delete account' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await trigger.click()
    await dialog.getByLabel('Password').fill('made-up-password')
    await dialog.getByRole('button', { name: 'Delete account' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible()
    // Signup yields an actual empty local account, not populated fixture Dailies.
    await page.getByLabel('Email', { exact: true }).fill('new@example.test')
    await page.getByLabel('Username').fill('New Player')
    await page.getByLabel('Password', { exact: true }).fill('made-up-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(page.getByText('No Dailies in this sample view.')).toBeVisible()
    await page.getByRole('link', { name: 'Manage Dailies' }).click()
    await page
      .getByRole('navigation', { name: 'Dailies', exact: true })
      .getByRole('link', { name: 'History' })
      .click()
    await expect(page.getByRole('heading', { name: 'No Daily outcomes yet' })).toBeVisible()
    if ([320, 1440].includes(width)) await capture(page, `new-account-daily-history-${width}`)
    await primaryNavigation(page, 'Expeditions')
    await page.getByRole('link', { name: 'Expedition history', exact: true }).click()
    await expect(page.getByText('No Expeditions yet.')).toBeVisible()
    if ([320, 1440].includes(width)) await capture(page, `new-account-expedition-history-${width}`)
    // The long fixture has the same backing lifecycle as every other Daily.
    await page.goto(`${base}/dailies?sample=long`)
    const longTitle =
      'Make time to read, reflect, and write a thoughtful note before the end of a very full day'
    await page.getByRole('button', { name: `Edit: ${longTitle}`, exact: true }).click()
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(longTitle)
    await page.getByRole('button', { name: 'Save Daily', exact: true }).click()
    await page.getByRole('button', { name: `Complete: ${longTitle}`, exact: true }).click()
    await expect(
      page.getByRole('button', { name: `Completed: ${longTitle}`, exact: true }),
    ).toBeDisabled()
    page.once('dialog', (prompt) => prompt.accept())
    await page.getByRole('button', { name: `Delete: ${longTitle}`, exact: true }).click()
    await expect(page.getByRole('heading', { name: longTitle, exact: true })).toHaveCount(0)
    await page.goto(`${base}/expeditions?sample=stale`)
    await expect(
      page.getByRole('button', { name: 'Launch Expedition', exact: true }),
    ).toBeDisabled()
    await expect(
      page.getByText('Quote unavailable until balance/readiness refreshes.'),
    ).toBeVisible()
    if ([320, 1440].includes(width)) await capture(page, `expeditions-stale-quote-${width}`)
    await page.getByRole('button', { name: 'Retry refresh' }).click()
    await expect(page.getByRole('button', { name: 'Launch Expedition', exact: true })).toBeEnabled()
    await page.goto(`${base}/dailies/new?sample=error`)
    await page.getByLabel('Title', { exact: true }).fill('Retained draft after rejection')
    await page.getByRole('button', { name: 'Save Daily', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Could not save')
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
      'Retained draft after rejection',
    )
    await page.getByRole('button', { name: 'Retry save' }).click()
    await page.getByRole('button', { name: 'Save Daily', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Retained draft after rejection', exact: true }),
    ).toBeVisible()
    await page.goto(`${base}/expeditions/sample-delayed`)
    await page.getByRole('button', { name: 'Retry result' }).click()
    await expect(
      page.getByRole('heading', { name: 'Successful Expedition', exact: true }),
    ).toBeVisible()
    await primaryNavigation(page, 'Ship')
    await page.getByRole('button', { name: 'Retry update' }).click()
    await expect(page.getByText('200', { exact: true })).toBeVisible()
    await primaryNavigation(page, 'Expeditions')
    await page.getByRole('link', { name: 'Expedition history', exact: true }).click()
    await page.getByRole('link', { name: 'View result delayed Expedition', exact: true }).click()
    await page.getByRole('button', { name: 'Retry result' }).click()
    await primaryNavigation(page, 'Ship')
    await expect(page.getByText('200', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry update' })).toHaveCount(0)
    // Browser Back respects the same dirty guard as links.
    await page.goto(`${base}/dailies`)
    await page.getByRole('button', { name: 'Create Daily', exact: true }).click()
    await page.getByLabel('Title', { exact: true }).fill('Unsaved sample')
    page.once('dialog', (prompt) => prompt.dismiss())
    await page.goBack()
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Unsaved sample')
    page.once('dialog', (prompt) => prompt.accept())
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: 'Dailies', exact: true }),
    ).toBeVisible()
    assert.deepEqual(errors, [])
    results.push({
      width,
      reducedMotion: true,
      routes: routes.length,
      automatedAxeViolations: 0,
      checks: [
        'states',
        'auth return',
        'auth retry',
        'new account',
        'empty new-account histories',
        'long Daily lifecycle',
        'auth date/filter return',
        'stale quote gate',
        'Daily rejection retains draft',
        'delayed result reward reconciles once',
        'dialog trap/Escape/restore',
        'dirty browser Back',
        'overflow',
      ],
    })
    await context.close()
    console.log(`Passed at ${width}px`)
  }
  await writeFile(
    `${directory}/verification.json`,
    JSON.stringify({ node: process.version, browser: browser.version(), results }, null, 2) + '\n',
  )
} finally {
  await browser.close()
}
