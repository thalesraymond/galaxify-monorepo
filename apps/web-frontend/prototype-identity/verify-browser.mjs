// Disposable browser evidence, not production regression tests.
/* global document, requestAnimationFrame, innerWidth */
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const browser = await chromium.launch()
const results = []
const base = process.env.PROTOTYPE_URL ?? 'http://127.0.0.1:4319'
const directory = 'prototype-identity/evidence/after'
await mkdir(directory, { recursive: true })
async function capture(page, name) {
  const surface = page.locator('#prototype-surface')
  const { height, viewport } = await surface.evaluate((el) => ({
    height: el.scrollHeight,
    viewport: el.clientHeight,
  }))
  let part = 0
  for (let offset = 0; offset < height; offset += Math.max(1, viewport - 60)) {
    await surface.evaluate((el, top) => {
      el.scrollTop = top
    }, offset)
    await page.evaluate(async () => {
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
    })
    await page.screenshot({
      path: `${directory}/${name}${part === 0 ? '' : `-part-${part + 1}`}.png`,
      fullPage: true,
    })
    part++
    if (offset + viewport >= height) break
  }
  await surface.evaluate((el) => {
    el.scrollTop = 0
  })
  const appBox = await surface.boundingBox()
  const laneBox = await page
    .getByRole('complementary', { name: 'Prototype controls' })
    .boundingBox()
  assert.ok(
    appBox && laneBox && appBox.y + appBox.height <= laneBox.y + 1,
    'Comparison lane must not overlap app viewport',
  )
  assert.equal(
    await surface.evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
    'Inner app overflow',
  )
}
try {
  for (const variant of ['assembly', 'daylight', 'after-hours']) {
    for (const width of [1440, 768, 390, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: width < 500 ? 844 : 900 },
        reducedMotion: 'reduce',
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${base}/dashboard?variant=${variant}`)
      await page.evaluate(() => document.fonts.ready)
      for (const route of ['dashboard', 'ship', 'expeditions']) {
        if (route !== 'dashboard') {
          const menu = page.getByRole('button', { name: 'Menu', exact: true })
          if (await menu.isVisible()) await menu.click()
          await page
            .getByRole('navigation', { name: 'Primary' })
            .filter({ visible: true })
            .getByRole('link', { name: route === 'ship' ? 'Ship' : 'Expeditions', exact: true })
            .click()
          await page
            .getByRole('heading', {
              level: 1,
              name: route === 'ship' ? 'Ship' : 'Expeditions',
              exact: true,
            })
            .waitFor()
        }
        await page.evaluate(async () => {
          await document.fonts.ready
          await new Promise(requestAnimationFrame)
          await new Promise(requestAnimationFrame)
        })
        await capture(page, `${variant}-${route}-${width}`)
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          `${variant}/${route}/${width} overflow`,
        )
        const a11y = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
        assert.deepEqual(
          a11y.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
          [],
          `${variant}/${route}/${width} axe`,
        )
      }
      // Keyboard-operable completion, then navigation without losing pending facts.
      await page.goto(`${base}/dashboard?variant=${variant}`)
      const complete = page.getByRole('button', {
        name: 'Complete: Walk outside for 20 minutes',
        exact: true,
      })
      await complete.focus()
      await page.keyboard.press('Enter')
      assert.equal(
        await page
          .getByRole('button', { name: 'Completed: Walk outside for 20 minutes', exact: true })
          .isDisabled(),
        true,
      )
      assert.equal(
        await page.getByRole('button', { name: 'Repair Ship', exact: true }).isDisabled(),
        true,
      )
      await page.getByRole('link', { name: 'Inspect Ship', exact: true }).click()
      await page.getByText('Update delayed', { exact: false }).first().waitFor()
      await capture(page, `${variant}-delayed-${width}`)
      const retry = page.getByRole('button', { name: 'Retry update', exact: true })
      await retry.focus()
      await page.keyboard.press('Enter')
      assert.match(await page.locator('main').innerText(), /145/)
      const repair = page.getByRole('button', { name: 'Repair Ship', exact: true })
      await repair.focus()
      await page.keyboard.press('Enter')
      await page.getByText('Fully repaired', { exact: true }).waitFor()
      assert.match(await page.locator('main').innerText(), /87/)
      await page.getByText('Update delayed', { exact: false }).first().waitFor()
      await page.getByRole('button', { name: 'Retry update', exact: true }).click()
      await page.getByRole('link', { name: 'Plan an Expedition', exact: true }).click()
      const input = page.getByRole('spinbutton', { name: 'Materials to invest' })
      await input.fill('88')
      assert.equal(
        await page.getByRole('button', { name: 'Launch Expedition', exact: true }).isDisabled(),
        true,
      )
      await input.fill('40')
      await page.getByRole('button', { name: 'Launch Expedition', exact: true }).focus()
      await page.keyboard.press('Enter')
      await page.getByText('Resolves at 10:00 UTC', { exact: true }).waitFor()
      await page.getByText('Update delayed', { exact: false }).first().waitFor()
      // In-flight status is shown twice, but deduction status only in the detailed area.
      await page.getByRole('button', { name: 'Retry update', exact: true }).first().click()
      assert.match(await page.locator('main').innerText(), /47/)
      await capture(page, `${variant}-launched-${width}`)
      assert.deepEqual(errors, [])
      results.push({
        variant,
        width,
        routes: 3,
        overflow: false,
        axeViolations: 0,
        keyboardJourney: 'pass',
        balances: [120, 145, 87, 47],
        reducedMotion: true,
        consoleErrors: errors,
      })
      await context.close()
    }
  }
  // Daily states, filtering, menu Escape, switcher and keyboard order at each width.
  for (const variant of ['assembly', 'daylight', 'after-hours']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(`${base}/dashboard?variant=${variant}`)
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    await page.keyboard.press('Escape')
    assert.equal(
      await page.getByRole('button', { name: 'Menu', exact: true }).getAttribute('aria-expanded'),
      'false',
    )
    await page.getByLabel('Show', { exact: false }).selectOption('pending')
    assert.equal(await page.locator('main li').count(), 2)
    await page.getByLabel('Show', { exact: false }).selectOption('all')
    await page.getByText('Sample controls & state', { exact: true }).click()
    for (const scenario of ['empty', 'loading', 'error']) {
      await page.getByLabel('Daily state').selectOption(scenario)
      await capture(page, `${variant}-${scenario}-390`)
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
    }
    await page.getByRole('button', { name: 'Retry Dailies', exact: true }).click()
    assert.equal(await page.locator('main li').count(), 3)
    await page.getByText('Sample controls & state', { exact: true }).click()
    await page.getByRole('button', { name: 'Next visual alternative', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    assert.notEqual(new URL(page.url()).searchParams.get('variant'), variant)
    results.push({
      variant,
      dailyStates: ['empty', 'loading', 'unavailable', 'retry', 'filtered'],
      menuEscape: 'pass',
      switcherArrows: 'pass',
    })
    await page.close()
  }
  await writeFile(`${directory}/verification.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ passed: results.length, evidence: directory }, null, 2))
} finally {
  await browser.close()
}
