import { expect, test } from '@playwright/test'

import { seedAuthenticated } from './session'

type FlowWindow = Window & {
  __reconciliationFlow?: { readonly completions: number }
}

/**
 * Combined browser journey for issue #228: a Daily award keeps the Ship balance
 * gate closed, expires as `Update delayed`, releases on a fresh authoritative
 * read, and the same freshly observed balance then renders on the Dashboard,
 * Ship, and Expeditions surfaces. The accepted Daily completion is never
 * replayed. Real-time bounded observation budgets are acceptable here; the mock
 * backend is only overridden to hold the award back until the round expires.
 */
test('a delayed Daily award releases fresh facts across views without replaying the command', async ({
  page,
}) => {
  test.setTimeout(45_000)

  await page.clock.setFixedTime(new Date('2026-01-15T12:00:00Z'))
  await seedAuthenticated(page)
  await page.goto('/dashboard')
  await page.waitForFunction(() => window.__galaxifyMock !== undefined)

  await page.evaluate(() => {
    const runtime = window.__galaxifyMock
    if (runtime === undefined) {
      throw new Error('The mock runtime is unavailable')
    }
    const { backend } = runtime
    let released = false
    let completions = 0
    window.addEventListener('test:balance-released', () => {
      released = true
    })

    // Hold the award back until the bounded observation expires, then publish
    // the fresh balance that the player's Retry observes.
    const originalGetShip = backend.getShip.bind(backend)
    backend.getShip = (token) => ({
      ...originalGetShip(token),
      materials_balance: released ? 270 : 250,
    })

    // Count the accepted command so the journey can prove it is never replayed.
    const originalCompleteDaily = backend.completeDaily.bind(backend)
    backend.completeDaily = (token, id) => {
      completions += 1
      ;(window as FlowWindow).__reconciliationFlow = { completions }
      return originalCompleteDaily(token, id)
    }
  })

  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await page.getByRole('button', { name: 'Complete Calibrate sensors' }).click()
  await page.locator('summary').filter({ hasText: 'Completed' }).click()

  const dailyRow = page.locator('[id^="daily-row-"]').filter({ hasText: 'Calibrate sensors' })
  const repair = page.getByRole('button', { name: 'Repair Ship' })

  await expect(dailyRow.getByText('Ship materials: 250')).toBeVisible()
  await expect(dailyRow.getByText('Updating…')).toBeVisible()
  await expect(repair).toBeDisabled()
  await expect(
    page
      .locator('#repair-balance-gate')
      .getByText('The Ship balance is updating after a Daily completion.')
      .first(),
  ).toBeVisible()

  // The observation expires unobserved; the gate releases only after its own
  // fresh read, which still shows the pre-award balance.
  await expect(dailyRow.getByText('Update delayed')).toBeVisible({ timeout: 15_000 })
  await expect(repair).toBeEnabled({ timeout: 5_000 })
  await expect(dailyRow.getByText('Ship materials: 250')).toBeVisible()

  // The facts change after expiry. The player-initiated Retry observes them;
  // the Daily completion itself is not sent again.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('test:balance-released'))
  })
  await dailyRow.getByRole('button', { name: 'Retry' }).click()
  await expect(dailyRow.getByText('Ship materials: 270')).toBeVisible({ timeout: 5_000 })
  await expect(dailyRow.getByText('Updating…')).toHaveCount(0)
  await expect(dailyRow.getByText('Update delayed')).toHaveCount(0)

  const primaryNav = page.getByRole('navigation', { name: 'Primary' })
  await primaryNav.getByRole('link', { name: 'Ship', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Ship' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Materials' }).getByText('270')).toBeVisible()

  await primaryNav.getByRole('link', { name: 'Expeditions', exact: true }).click()
  await expect(page.getByText('You have 270 materials')).toBeVisible()

  await primaryNav.getByRole('link', { name: 'Dashboard', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Materials' }).getByText('270')).toBeVisible()

  const completions = await page.evaluate(
    () => (window as FlowWindow).__reconciliationFlow?.completions,
  )
  expect(completions).toBe(1)
})
