import { expect, test, type Page } from '@playwright/test'

import { expectOnlyRefreshTokenPersisted, SESSION_REFRESH_STORAGE_KEY } from './session'

/**
 * Phase 1 real-stack release smoke (issue #161, delivery spec §8): ONE Player
 * journey from signup through logout against the COMPLETE real stack — every
 * exchange is a live request to the Vite dev server and through its proxies to
 * the real User, Daily, Ship, and Expedition services, RabbitMQ, and the
 * daily-cron worker. No MSW is involved.
 *
 * Environment (all gated — this file is a no-op unless `RUN_REAL_STACK=1`):
 *   RUN_REAL_STACK=1
 *   REAL_STACK_BASE_URL   http://127.0.0.1:5173 (default; real-mode Vite)
 *
 * Prerequisites (offline, local only):
 *   1. Local infrastructure healthy (`make dev-infra`): postgres user/daily/
 *      ship/expedition DBs on :5431-:5434 and RabbitMQ on :5672.
 *   2. The full real stack started with a short missed-Daily sweep so the
 *      hull-damage leg completes in bounded time:
 *        CRON_INTERVAL=15s make dev
 *      (the supervisor builds every service/worker into its gitignored bin/,
 *      applies migrations, and starts Vite in real mode on :5173).
 *
 * Run:
 *   RUN_REAL_STACK=1 npx playwright test e2e/real-stack-smoke.spec.ts --project=chromium
 *
 * The single journey proves, in order: signup provisioning, session
 * persistence (reload restoration), Daily create/complete, the observed
 * Daily-to-Ship materials effect, missed-Daily hull damage, eligible repair
 * (and its Ship-to-Expedition readiness propagation), Expedition launch,
 * Profile update, and logout. Wire contracts are exercised implicitly: the
 * browser transport validates every success body against the generated Zod
 * schemas. It is one test because it is one Player with one persisted session.
 */
const RUN_REAL_STACK = process.env.RUN_REAL_STACK === '1'
const REAL_BASE_URL = process.env.REAL_STACK_BASE_URL ?? 'http://127.0.0.1:5173'

const PASSWORD = 'password123'

/** Every run uses a unique account so the smoke is repeatable against persistent local databases. */
const account = {
  email: `smoke-${Date.now()}-${Math.random().toString(36).slice(2)}@galaxify.test`,
  username: `smoke_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(
    0,
    30,
  ),
}

test.skip(!RUN_REAL_STACK, 'set RUN_REAL_STACK=1 to run the real-stack smoke (see file header)')

test.use({ baseURL: REAL_BASE_URL })

test('signup through logout against the complete real stack', async ({ page }) => {
  test.setTimeout(420_000)

  // --- Signup provisioning and reload restoration -------------------------

  await page.goto('/signup')
  await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible()

  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Username').fill(account.username)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await expectOnlyRefreshTokenPersisted(page)

  // Reload restoration: the persisted refresh token bootstraps a fresh
  // session against the real User Service.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await expectOnlyRefreshTokenPersisted(page)

  // --- Daily create/complete and the observed Ship effect -----------------

  await expectDailiesReady(page)

  await createDaily(page, 'Stargaze the horizon', 10)
  await page.getByRole('button', { name: 'Complete Stargaze the horizon' }).click()

  // The completed row moves into the Completed section of the list.
  await expect(page.getByRole('heading', { name: 'Completed (1)' })).toBeVisible()

  // Observed Ship effect: the Daily-to-Ship event propagation raises the
  // materials balance from the provisioned 0 to the EASY reward of 10.
  await expectShipMaterials(page, 10)
  await expectHullHealth(page, 100)

  // --- Missed Daily damage and eligible repair ----------------------------

  // This Daily is deliberately left pending past its deadline: the
  // daily-cron sweep (CRON_INTERVAL=15s locally) marks it missed and the
  // Daily-to-Ship propagation applies the EASY missed damage of 5 hull.
  await createDaily(page, 'Chart the nebula', 1)

  await expect
    .poll(async () => readHullHealthAfterReload(page), {
      timeout: 180_000,
      intervals: [5_000],
    })
    .toBeLessThan(100)

  // Repair is eligible: hull is damaged and the materials balance is positive.
  const repair = page.getByRole('button', { name: 'Repair Ship' })
  await expect(repair).toBeEnabled()
  await repair.click()

  await expect(page.getByText('The Ship was repaired.')).toBeAttached()
  await expectHullHealth(page, 100)
  // Repair spent the 5 missing hull in materials (10 - 5).
  await expectShipMaterials(page, 5)

  // --- Expedition launch on the repaired Ship -----------------------------

  await page.goto('/expeditions')
  await expect(page.getByRole('heading', { level: 2, name: 'Launch an Expedition' })).toBeVisible()

  await page.getByLabel('Materials to invest').fill('1')

  // Ship-to-Expedition readiness may still be propagating. Wait only for the
  // user-visible eligibility condition; this journey never retries a product
  // action to make itself pass.
  const ready = page.getByText('Ready to launch.')
  await expect(ready).toBeVisible({ timeout: 36_000 })

  await page.getByRole('button', { name: 'Launch Expedition' }).click()

  // The launch replaces the form with the in-flight Expedition overview; the
  // announcement itself lives inside the form and unmounts with it, so assert
  // the durable outcome: the persisted Expedition and its investment.
  const inFlight = page.getByRole('region', { name: 'Expedition in flight' })
  await expect(inFlight).toBeVisible()
  await expect(inFlight.getByText('1 materials')).toBeVisible()
  await expect(inFlight.getByText('In flight', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Launch an Expedition' })).toBeHidden()

  // --- Profile update and logout ------------------------------------------

  await page.goto('/profile')
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()

  const username = page.getByLabel('Username')
  await username.fill(`${account.username}_rn`.slice(0, 30))
  await page.getByRole('button', { name: 'Save username' }).click()
  await expect(page.getByText('Your username was updated.')).toBeAttached()

  await page.getByRole('button', { name: 'Account' }).first().click()
  await page.getByRole('menuitem', { name: 'Log out' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
  await expect(page.getByText('You have been signed out.', { exact: true })).toBeVisible()
  const stored = await page.evaluate(({ storageKey }) => window.localStorage.getItem(storageKey), {
    storageKey: SESSION_REFRESH_STORAGE_KEY,
  })
  expect(stored).toBeNull()
})

/** Waits until the real Daily service has consumed signup provisioning. */
async function expectDailiesReady(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.goto('/dailies')
        const preparing = await page
          .getByRole('heading', {
            name: 'Preparing your Dailies',
          })
          .count()
        const unavailable = await page
          .getByRole('heading', {
            name: 'Dailies are unavailable',
          })
          .count()
        return preparing === 0 && unavailable === 0
      },
      { timeout: 90_000, intervals: [3_000] },
    )
    .toBe(true)
  await expect(page.getByRole('heading', { level: 1, name: 'Dailies' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No Dailies' })).toBeVisible()
}

/** Creates a Daily with the given title due `dueInMinutes` from now. */
async function createDaily(page: Page, title: string, dueInMinutes: number): Promise<void> {
  await page.goto('/dailies/new')
  await expect(page.getByRole('heading', { level: 2, name: 'New Daily' })).toBeVisible()

  const due = new Date(Date.now() + dueInMinutes * 60_000)
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Due date').fill(toDateInput(due))
  await page.getByLabel('Due time').fill(toTimeInput(due))

  await page.getByRole('button', { name: 'Create Daily' }).click()

  await expect(page).toHaveURL(/\/dailies/)
  await expect(page.getByRole('heading', { level: 3, name: title })).toBeVisible()
}

async function expectShipMaterials(page: Page, balance: number): Promise<void> {
  await page.goto('/ship')
  await expect(page.getByRole('heading', { level: 2, name: 'Ship status' })).toBeVisible()
  const materials = page.getByRole('heading', { level: 3, name: 'Materials' }).locator('..')
  await expect(materials.getByText(String(balance), { exact: true })).toBeVisible()
}

async function expectHullHealth(page: Page, health: number): Promise<void> {
  await expect(page.getByRole('progressbar', { name: 'Hull health' })).toHaveAttribute(
    'aria-valuenow',
    String(health),
  )
}

/** The Ship page does not poll on its own; a reload is the Player's refresh. */
async function readHullHealthAfterReload(page: Page): Promise<number> {
  await page.goto('/ship')
  await page.getByRole('progressbar', { name: 'Hull health' }).waitFor()
  const value = await page
    .getByRole('progressbar', { name: 'Hull health' })
    .getAttribute('aria-valuenow')
  return Number(value)
}

function toDateInput(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toTimeInput(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}
