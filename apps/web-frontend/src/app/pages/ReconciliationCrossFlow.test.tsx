process.env.TZ = 'UTC'

import { act, fireEvent, queries, screen, within } from '@testing-library/react'
import type { BoundFunctions } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/app/queryClient'
import { zExpeditionLaunchBody } from '@/api/generated/expedition/zod.gen'
import { SESSION_REFRESH_STORAGE_KEY } from '@/features/auth'
import { shipQueryKey } from '@/features/ship'
import {
  createDamagedShip,
  createMockTestServer,
  FIXED_DAILY_IDS,
  FIXED_EXPEDITION_IDS,
  FIXED_MOCK_EPOCH_MS,
  ManualMockScheduler,
  onUnhandledMockRequest,
} from '@/mocks'
import {
  clearDownstreamObservations,
  downstreamReconciliation,
  getBalanceGateKeys,
} from '@/shared/reconciliation'
import { advanceFakeTime, advanceUntil, seedAuthenticatedSession } from '@/test/expeditionTestUtils'
import { enableFakeTimers } from '@/test/fakeTimers'
import { renderExpeditionRoute } from '@/test/renderExpeditionRoute'

/**
 * Combined cross-flow suite for Downstream Reconciliation (`web-frontend.md`
 * §3.2, §3.4, §5). These journeys deliberately use the real callers — Daily
 * completion, Ship repair, Expedition launch, and the shared routes — rather
 * than the module's public functions alone, so the seam between the session
 * coordinator and every feature adapter is exercised together.
 *
 * The browser can only observe aggregate Ship facts. A balance change may be
 * caused by another award or by spending, so these tests assert published
 * facts, distinct per-outcome expectations, and freshness-based gate release —
 * never receipt-level attribution to the command that started the round.
 */

const scheduler = new ManualMockScheduler(FIXED_MOCK_EPOCH_MS)
const server = createMockTestServer({ scenario: 'established-player', scheduler })

const DAILY_AWARD_KEY = (dailyId: string): string => `daily:${dailyId}:award`
const EXPEDITION_REWARD_KEY = (expeditionId: string): string => `expedition:${expeditionId}:reward`

let balance = 250
let shipRequests = 0
let failShipReads = false
let heldShipReadStarted = false
let holdNextShipRead = false
let releaseHeldShipRead = () => {}

let holdDailyCompletion = false
let heldDailyCompletionStarted = false
let releaseHeldDailyCompletion = () => {}

let holdNextRepair = false
let heldRepairStarted = false
let releaseHeldRepair = () => {}

function resetReadBookkeeping(): void {
  shipRequests = 0
  heldShipReadStarted = false
  holdNextShipRead = false
  releaseHeldShipRead = () => {}
}

function setVisibility(visible: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (visible ? 'visible' : 'hidden'),
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => online,
  })
  window.dispatchEvent(new Event(online ? 'online' : 'offline'))
}

function pause(pauseKind: 'hidden' | 'offline'): void {
  if (pauseKind === 'hidden') setVisibility(false)
  else setOnline(false)
}

function resume(pauseKind: 'hidden' | 'offline'): void {
  if (pauseKind === 'hidden') setVisibility(true)
  else setOnline(true)
}

/** The Daily row that displays the reconciled balance for one Daily title. */
function dailyRow(title: string): BoundFunctions<typeof queries> {
  const heading = screen.getByRole('heading', { name: title })
  // eslint-disable-next-line testing-library/no-node-access -- the row is identified by its stable DOM id
  const row = heading.closest('[id^="daily-row-"]')
  if (!(row instanceof HTMLElement)) {
    throw new Error(`The Daily row for ${title} was not found.`)
  }
  return within(row)
}

function materialsRegion(): BoundFunctions<typeof queries> {
  return within(screen.getByRole('region', { name: 'Materials' }))
}

async function waitForDashboardPanels(): Promise<void> {
  await advanceUntil(
    () =>
      screen.queryByRole('heading', { level: 1, name: 'Dashboard' }) !== null &&
      screen.queryByRole('button', { name: 'Repair Ship' }) !== null,
    'the Dashboard panels',
  )
}

async function waitForDashboard(): Promise<void> {
  await advanceUntil(
    () =>
      screen.queryByRole('button', { name: 'Complete Calibrate sensors' }) !== null &&
      screen.queryByRole('button', { name: 'Repair Ship' }) !== null,
    'the Dashboard panels',
  )
}

async function waitForShipPage(): Promise<void> {
  await advanceUntil(
    () =>
      screen.queryByRole('heading', { level: 1, name: 'Ship' }) !== null &&
      screen.queryByRole('region', { name: 'Materials' }) !== null,
    'the Ship page',
  )
}

async function waitForExpeditionsPage(): Promise<void> {
  await advanceUntil(
    () => screen.queryByLabelText('Materials to invest') !== null,
    'the Expedition launch form',
  )
}

function navigateTo(name: 'Dashboard' | 'Dailies' | 'Ship' | 'Expeditions'): void {
  fireEvent.click(screen.getByRole('link', { name }))
}

beforeEach(async () => {
  clearDownstreamObservations()
  balance = 250
  failShipReads = false
  resetReadBookkeeping()
  holdDailyCompletion = false
  heldDailyCompletionStarted = false
  releaseHeldDailyCompletion = () => {}
  holdNextRepair = false
  heldRepairStarted = false
  releaseHeldRepair = () => {}
  setVisibility(true)
  setOnline(true)
  server.reset()
  server.server.listen({ onUnhandledRequest: onUnhandledMockRequest })
  server.server.use(
    http.get('/api/ship/ships/me', async () => {
      shipRequests += 1
      if (failShipReads) {
        return HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Ship read failed' } },
          { status: 500 },
        )
      }
      if (holdNextShipRead) {
        holdNextShipRead = false
        heldShipReadStarted = true
        await new Promise<void>((resolve) => {
          releaseHeldShipRead = resolve
        })
      }
      return HttpResponse.json(createDamagedShip({ materials_balance: balance }))
    }),
    http.post('/api/daily/dailies/:id/complete', async ({ params, request }) => {
      const token = /^Bearer (.+)$/u.exec(request.headers.get('Authorization') ?? '')?.[1]
      const completion = server.backend.completeDaily(token, String(params.id))
      if (holdDailyCompletion) {
        holdDailyCompletion = false
        heldDailyCompletionStarted = true
        await new Promise<void>((resolve) => {
          releaseHeldDailyCompletion = resolve
        })
      }
      return HttpResponse.json(completion)
    }),
    http.post('/api/ship/ships/repair', async ({ request }) => {
      const token = /^Bearer (.+)$/u.exec(request.headers.get('Authorization') ?? '')?.[1]
      const ship = server.backend.repairShip(token)
      if (holdNextRepair) {
        holdNextRepair = false
        heldRepairStarted = true
        await new Promise<void>((resolve) => {
          releaseHeldRepair = resolve
        })
      }
      return HttpResponse.json(ship)
    }),
  )
  window.localStorage.clear()
  await seedAuthenticatedSession()
  enableFakeTimers(FIXED_MOCK_EPOCH_MS)
})

afterEach(() => {
  act(() => {
    clearDownstreamObservations()
  })
  holdNextShipRead = false
  holdDailyCompletion = false
  holdNextRepair = false
  failShipReads = false
  vi.useRealTimers()
  setVisibility(true)
  setOnline(true)
  server.server.resetHandlers()
  server.server.close()
  window.localStorage.clear()
})

describe('same resource across views', () => {
  it('survives route changes mid-round and publishes one fresh balance everywhere', async () => {
    renderExpeditionRoute('/dashboard')
    await waitForDashboard()
    expect(materialsRegion().getByText('250')).toBeInTheDocument()
    await advanceFakeTime(1_000)

    resetReadBookkeeping()
    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    await advanceUntil(
      () => dailyRow('Calibrate sensors').queryByText('Updating…') !== null,
      'the updating Daily award',
    )
    expect(dailyRow('Calibrate sensors').getByText('Ship materials: 250')).toBeInTheDocument()
    const readsAfterImmediate = shipRequests
    expect(readsAfterImmediate).toBe(1)

    // Route changes do not restart the round or launch redundant reads.
    navigateTo('Dailies')
    await advanceUntil(
      () => screen.queryByRole('heading', { level: 1, name: 'Dailies' }) !== null,
      'the Dailies route',
    )
    expect(dailyRow('Calibrate sensors').getByText('Updating…')).toBeInTheDocument()
    expect(shipRequests).toBe(readsAfterImmediate)

    navigateTo('Dashboard')
    await waitForDashboardPanels()
    expect(dailyRow('Calibrate sensors').getByText('Updating…')).toBeInTheDocument()
    expect(shipRequests).toBe(readsAfterImmediate)

    navigateTo('Ship')
    await waitForShipPage()
    expect(screen.getByRole('button', { name: 'Repair Ship' })).toBeDisabled()
    expect(shipRequests).toBe(readsAfterImmediate)

    navigateTo('Expeditions')
    await waitForExpeditionsPage()
    expect(screen.getByText('You have 250 materials')).toBeInTheDocument()
    expect(shipRequests).toBe(readsAfterImmediate)

    // The surviving round's next scheduled read publishes the fresh balance;
    // one read, not one per route.
    balance = 260
    await advanceFakeTime(1_000)
    await advanceUntil(
      () => screen.queryByText('You have 260 materials') !== null,
      'the fresh launch-form balance',
    )
    expect(shipRequests).toBe(readsAfterImmediate + 1)

    navigateTo('Dashboard')
    await advanceUntil(
      () =>
        dailyRow('Calibrate sensors').queryByText('Ship materials: 260') !== null &&
        dailyRow('Calibrate sensors').queryByText('Updating…') === null,
      'the Dashboard balance',
    )
    expect(materialsRegion().getByText('260')).toBeInTheDocument()

    navigateTo('Ship')
    await waitForShipPage()
    expect(materialsRegion().getByText('260')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repair Ship' })).toBeEnabled()

    navigateTo('Dailies')
    await advanceUntil(
      () => dailyRow('Calibrate sensors').queryByText('Ship materials: 260') !== null,
      'the Dailies row balance',
    )
    expect(dailyRow('Calibrate sensors').queryByText('Updating…')).toBeNull()

    // Cached fresh facts render on every route without another read.
    expect(shipRequests).toBe(readsAfterImmediate + 1)
  })
})

describe('shared in-flight reads', () => {
  it('shares one Ship request between two independent pending awards and evaluates them separately', async () => {
    const client = createQueryClient()
    const querySpy = vi.spyOn(client, 'query')
    renderExpeditionRoute('/dashboard', client)
    await waitForDashboard()
    expect(materialsRegion().getByText('250')).toBeInTheDocument()
    await advanceFakeTime(1_000)

    resetReadBookkeeping()
    balance = 260
    holdNextShipRead = true

    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    await advanceUntil(() => heldShipReadStarted, 'the first held award read')
    fireEvent.click(screen.getByRole('button', { name: 'Complete Stretch the solar sails' }))
    await advanceUntil(() => getBalanceGateKeys().length === 2, 'both independent observation keys')

    // Both keys attempted their mark-0 read; TanStack Query owns the in-flight
    // promise, so the second attempt shares the first HTTP request.
    expect(querySpy).toHaveBeenCalledTimes(2)
    expect(shipRequests).toBe(1)

    releaseHeldShipRead()
    await advanceUntil(
      () =>
        screen.queryAllByText('Ship materials: 260').length === 2 &&
        dailyRow('Calibrate sensors').queryByText('Updating…') === null,
      'the shared fresh facts',
    )

    // Same facts, distinct per-outcome expectations: the Easy award is
    // satisfied at +10, the Hard award still needs +50 and keeps probing.
    expect(dailyRow('Calibrate sensors').queryByText('Updating…')).toBeNull()
    expect(dailyRow('Stretch the solar sails').getByText('Updating…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repair Ship' })).toBeDisabled()
    expect(shipRequests).toBe(1)
  })
})

describe('slow and failed reads', () => {
  it('keeps last confirmed facts through failures and publishes the next fresh balance everywhere', async () => {
    server.server.use(
      http.post('/api/expedition/expeditions/launch', async ({ request }) => {
        const token = /^Bearer (.+)$/u.exec(request.headers.get('Authorization') ?? '')?.[1]
        const body = zExpeditionLaunchBody.parse(await request.json())
        return HttpResponse.json(
          server.backend.launchExpedition(token, {
            materials_invested: Number(body.materials_invested),
          }),
        )
      }),
    )

    renderExpeditionRoute('/expeditions')
    await waitForExpeditionsPage()
    await advanceUntil(() => screen.queryByText('You have 250 materials') !== null, 'the balance')
    fireEvent.change(screen.getByLabelText('Materials to invest'), { target: { value: '40' } })
    await advanceUntil(() => screen.queryByText('Ready to launch.') !== null, 'the launch quote')

    // The accepted launch starts the deduction round; every Ship read fails
    // from here until the rounds have expired.
    failShipReads = true
    fireEvent.click(screen.getByRole('button', { name: 'Launch Expedition' }))
    await advanceUntil(() => screen.queryByText('Expedition in flight') !== null, 'the launch')
    await advanceUntil(
      () => screen.queryByText(/Available materials: 250/) !== null,
      'the retained launch balance',
    )
    expect(screen.getByText('Updating…')).toBeInTheDocument()

    // The Daily award joins the pending deduction round and also fails its
    // fresh read; retained facts stay visible and neither round settles.
    navigateTo('Dashboard')
    await waitForDashboard()
    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    await advanceUntil(
      () =>
        dailyRow('Calibrate sensors').queryByText('Updating…') !== null &&
        screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
      'the failed Daily award',
    )
    expect(materialsRegion().getByText('250')).toBeInTheDocument()
    expect(dailyRow('Calibrate sensors').getByText('Ship materials: …')).toBeInTheDocument()

    // The Ship route retains the same confirmed facts and labels the failed
    // refresh rather than publishing retained data as fresh.
    navigateTo('Ship')
    await waitForShipPage()
    expect(materialsRegion().getByText('250')).toBeInTheDocument()
    await advanceUntil(
      () => screen.queryByText('Showing the last known Ship status. Refreshing failed.') !== null,
      'the failed Ship refresh',
    )
    expect(screen.getByRole('button', { name: 'Repair Ship' })).toBeDisabled()

    navigateTo('Dashboard')
    await waitForDashboardPanels()
    expect(dailyRow('Calibrate sensors').getByText('Updating…')).toBeInTheDocument()

    // Expiry is delayed, not command failure; the gate's own fresh read also
    // fails, so it stays stale and offers a local Retry.
    await advanceFakeTime(9_000)
    await advanceUntil(
      () => dailyRow('Calibrate sensors').queryByText('Update delayed') !== null,
      'the delayed Daily award',
    )
    await advanceUntil(
      () =>
        screen.queryAllByText('The Ship balance could not be refreshed. Retry before using it.')
          .length > 0,
      'the stale gate',
    )
    const repair = screen.getByRole('button', { name: 'Repair Ship' })
    expect(repair).toBeDisabled()
    expect(repair).toHaveAccessibleDescription(/could not be refreshed/)
    expect(materialsRegion().getByRole('button', { name: 'Retry' })).toBeEnabled()

    // The deduction round expired alongside the Daily; both views agree on the
    // last confirmed balance until a read succeeds.
    navigateTo('Expeditions')
    await advanceUntil(() => screen.queryByText('Expedition in flight') !== null, 'the overview')
    await advanceUntil(
      () => screen.queryByText(/Available materials: 250/) !== null,
      'the retained deduction balance',
    )
    // The deduction round was paused while no Expedition view displayed it;
    // its remaining budget resumes here and expires unobserved.
    await advanceFakeTime(9_000)
    await advanceUntil(() => screen.queryByText('Update delayed') !== null, 'the delayed deduction')

    // The next successful read publishes the same fresh balance everywhere.
    balance = 270
    failShipReads = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await advanceUntil(
      () => screen.queryByText(/Available materials: 270/) !== null,
      'the fresh deduction facts',
    )

    navigateTo('Dashboard')
    await waitForDashboardPanels()
    expect(materialsRegion().getByText('270')).toBeInTheDocument()
    fireEvent.click(dailyRow('Calibrate sensors').getByRole('button', { name: 'Retry' }))
    await advanceUntil(
      () =>
        dailyRow('Calibrate sensors').queryByText('Ship materials: 270') !== null &&
        dailyRow('Calibrate sensors').queryByText('Update delayed') === null,
      'the fresh Daily facts',
    )

    navigateTo('Ship')
    await waitForShipPage()
    expect(materialsRegion().getByText('270')).toBeInTheDocument()
  })

  it('skips marks past a read bound, expires, and makes cleared-session retries no-ops', async () => {
    renderExpeditionRoute('/dashboard')
    await waitForDashboard()
    await advanceFakeTime(1_000)

    resetReadBookkeeping()
    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    await advanceUntil(
      () => dailyRow('Calibrate sensors').queryByText('Updating…') !== null,
      'the updating Daily award',
    )

    // Hold the read at the ~1 s mark past the 5 s bound. The timeout expires
    // the round instead of firing the 2/4/8 s marks as a catch-up burst.
    await advanceFakeTime(600)
    holdNextShipRead = true
    await advanceFakeTime(600)
    await advanceUntil(() => heldShipReadStarted, 'the held slow read')
    const readsBeforeTimeout = shipRequests
    failShipReads = true
    await advanceFakeTime(5_000)
    await advanceUntil(
      () => dailyRow('Calibrate sensors').queryByText('Update delayed') !== null,
      'the timed-out award',
    )

    // Only the gate's own expiry read follows the timeout; the expired
    // observation never replays the skipped 2/4/8 s marks.
    await advanceUntil(
      () =>
        screen.queryAllByText('The Ship balance could not be refreshed. Retry before using it.')
          .length > 0,
      'the stale gate after timeout',
    )
    expect(shipRequests).toBeLessThanOrEqual(readsBeforeTimeout + 1)
    const readsAfterExpiry = shipRequests
    await advanceFakeTime(10_000)
    expect(shipRequests).toBe(readsAfterExpiry)
    expect(materialsRegion().getByRole('button', { name: 'Retry' })).toBeEnabled()

    // Retry one expired key while the other Daily award is still updating: the
    // gate stays closed for the newer round.
    failShipReads = false
    fireEvent.click(screen.getByRole('button', { name: 'Complete Stretch the solar sails' }))
    await advanceUntil(
      () => dailyRow('Stretch the solar sails').queryByText('Updating…') !== null,
      'the second pending award',
    )
    fireEvent.click(dailyRow('Calibrate sensors').getByRole('button', { name: 'Retry' }))
    await advanceUntil(
      () => dailyRow('Calibrate sensors').queryByText('Updating…') !== null,
      'the retried award',
    )
    expect(dailyRow('Stretch the solar sails').getByText('Updating…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repair Ship' })).toBeDisabled()

    // A session clear retires the round; invoking Retry afterwards is a no-op
    // and cannot start another read.
    const readsBeforeClear = shipRequests
    act(() => {
      clearDownstreamObservations()
    })
    downstreamReconciliation.retry(DAILY_AWARD_KEY(FIXED_DAILY_IDS.calibrate))
    await advanceFakeTime(5_000)
    expect(downstreamReconciliation.getPhase(DAILY_AWARD_KEY(FIXED_DAILY_IDS.calibrate))).toBe(
      'idle',
    )
    expect(shipRequests).toBe(readsBeforeClear)
  })
})

describe('commands under the balance gate', () => {
  it('issues no command while the Daily gate is closed and never replays the accepted launch', async () => {
    let repairCommands = 0
    let launchCommands = 0
    server.server.use(
      http.post('/api/ship/ships/repair', () => {
        repairCommands += 1
        return HttpResponse.json(createDamagedShip({ hull_health: 100, materials_balance: 246 }))
      }),
      http.post('/api/expedition/expeditions/launch', async ({ request }) => {
        launchCommands += 1
        const token = /^Bearer (.+)$/u.exec(request.headers.get('Authorization') ?? '')?.[1]
        const body = zExpeditionLaunchBody.parse(await request.json())
        return HttpResponse.json(
          server.backend.launchExpedition(token, {
            materials_invested: Number(body.materials_invested),
          }),
        )
      }),
    )

    renderExpeditionRoute('/dashboard')
    await waitForDashboard()

    // The Daily award keeps the gate closed; neither gated action may send a
    // command or imitate an event consumer while the balance is unconfirmed.
    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    await advanceUntil(
      () => screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
      'the closed Dashboard gate',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Repair Ship' }))
    expect(repairCommands).toBe(0)

    navigateTo('Expeditions')
    await waitForExpeditionsPage()
    fireEvent.change(screen.getByLabelText('Materials to invest'), { target: { value: '40' } })
    await advanceUntil(() => screen.queryByText('Ready to launch.') !== null, 'the launch quote')
    const launch = screen.getByRole('button', { name: 'Launch Expedition' })
    expect(launch).toBeDisabled()
    fireEvent.click(launch)
    expect(launchCommands).toBe(0)

    // The award expires unobserved; only the gate's fresh authoritative read
    // releases it. The player then issues exactly one command.
    await advanceFakeTime(9_000)
    await advanceUntil(() => !launch.hasAttribute('disabled'), 'the fresh gate release')
    expect(repairCommands).toBe(0)
    expect(launchCommands).toBe(0)

    fireEvent.click(launch)
    await advanceUntil(() => screen.queryByText('Expedition in flight') !== null, 'the launch')
    expect(launchCommands).toBe(1)

    // The deduction observation expires, but an accepted command is
    // authoritative and is never automatically replayed.
    await advanceFakeTime(9_000)
    await advanceUntil(() => screen.queryByText('Update delayed') !== null, 'the delayed deduction')
    expect(launchCommands).toBe(1)
    expect(repairCommands).toBe(0)

    // A player-initiated Retry re-observes; it never re-sends the launch.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await advanceFakeTime(9_000)
    expect(launchCommands).toBe(1)
  })
})

describe('aggregate attribution honesty', () => {
  it('lets an unrelated award satisfy a threshold and unrelated spending mask one without claiming attribution', async () => {
    renderExpeditionRoute('/dashboard')
    await waitForDashboard()
    expect(materialsRegion().getByText('250')).toBeInTheDocument()

    // An unrelated award raises the balance past this Daily's +10 threshold.
    // The aggregate fact satisfies the expected change even though the browser
    // cannot prove this Daily's own event was consumed.
    balance = 265
    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    await advanceUntil(
      () => dailyRow('Calibrate sensors').queryByText('Ship materials: 265') !== null,
      'the aggregate-satisfied award',
    )
    expect(dailyRow('Calibrate sensors').queryByText('Updating…')).toBeNull()
    expect(dailyRow('Calibrate sensors').getByText('Completed · +10 materials')).toBeInTheDocument()

    // Unrelated spending drops the balance below the next threshold, masking
    // the Hard award until the facts change again.
    balance = 245
    fireEvent.click(screen.getByRole('button', { name: 'Complete Stretch the solar sails' }))
    await advanceUntil(
      () => dailyRow('Stretch the solar sails').queryByText('Ship materials: 245') !== null,
      'the masked award',
    )
    expect(dailyRow('Stretch the solar sails').getByText('Updating…')).toBeInTheDocument()
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()

    // Expiry releases the gate only after its own fresh read; the award remains
    // unobserved and the row says so. Release is freshness-based, not proof the
    // expected event arrived.
    await advanceFakeTime(9_000)
    await advanceUntil(
      () => !screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
      'the freshness-based gate release',
    )
    expect(dailyRow('Stretch the solar sails').getByText('Update delayed')).toBeInTheDocument()
    expect(dailyRow('Stretch the solar sails').getByText('Ship materials: 245')).toBeInTheDocument()

    // The facts later move past the threshold; a local Retry keeps the original
    // baseline and expectation and observes the aggregate change.
    balance = 320
    fireEvent.click(dailyRow('Stretch the solar sails').getByRole('button', { name: 'Retry' }))
    await advanceUntil(
      () =>
        dailyRow('Stretch the solar sails').queryByText('Ship materials: 320') !== null &&
        dailyRow('Stretch the solar sails').queryByText('Update delayed') === null,
      'the retried award',
    )

    // The UI publishes facts and the typed expected reward; it never claims
    // receipt-level confirmation of the underlying event.
    expect(screen.queryByText(/award (?:was )?confirmed/i)).not.toBeInTheDocument()
  })
})

describe('late results across a session boundary', () => {
  it('discards a held Daily completion and reward read after logout without repopulating cleared state', async () => {
    const expeditionId = FIXED_EXPEDITION_IDS.resolvedSuccess
    const client = createQueryClient()

    // Start a reward observation on the resolved detail and hold its fresh
    // Ship read; then leave the page while it is still in flight.
    holdNextShipRead = true
    renderExpeditionRoute(`/expeditions/${expeditionId}`, client)
    await advanceUntil(() => heldShipReadStarted, 'the held reward read')

    navigateTo('Dashboard')
    await waitForDashboard()
    holdDailyCompletion = true
    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    await advanceUntil(() => heldDailyCompletionStarted, 'the held Daily completion')

    // Session boundary: logout clears the private query cache and cancels the
    // session-owned observations while both responses are still in flight.
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }))
    await advanceUntil(
      () => window.localStorage.getItem(SESSION_REFRESH_STORAGE_KEY) === null,
      'logout',
    )

    await act(async () => {
      releaseHeldDailyCompletion()
      releaseHeldShipRead()
      await Promise.resolve()
    })
    await advanceFakeTime(500)

    // Late work cannot reopen a round, restore a gate key, or repopulate the
    // cleared shared queries with previous-session facts.
    expect(client.getQueryData(shipQueryKey)).toBeUndefined()
    expect(client.getQueryCache().getAll()).toHaveLength(0)
    expect(downstreamReconciliation.getPhase(DAILY_AWARD_KEY(FIXED_DAILY_IDS.calibrate))).toBe(
      'idle',
    )
    expect(downstreamReconciliation.getPhase(EXPEDITION_REWARD_KEY(expeditionId))).toBe('idle')
    expect(getBalanceGateKeys()).toHaveLength(0)
  })
})

describe('already-paused starts', () => {
  it.each(['hidden', 'offline'] as const)(
    'starts a Daily award paused while %s and resumes when available',
    async (pauseKind) => {
      renderExpeditionRoute('/dashboard')
      await waitForDashboard()
      expect(materialsRegion().getByText('250')).toBeInTheDocument()

      resetReadBookkeeping()
      balance = 260
      if (pauseKind === 'offline') {
        // The harness cannot reject requests that start while offline; issue
        // the command first, hold its response, then pause before it settles so
        // the observation still *starts* paused.
        holdDailyCompletion = true
        fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
        await advanceUntil(() => heldDailyCompletionStarted, 'the held Daily completion')
        pause(pauseKind)
        await act(async () => {
          releaseHeldDailyCompletion()
          await Promise.resolve()
        })
      } else {
        pause(pauseKind)
        fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
      }
      await advanceUntil(
        () => dailyRow('Calibrate sensors').queryByText('Ship materials: …') !== null,
        'the paused Daily award',
      )

      await advanceFakeTime(9_000)
      expect(shipRequests).toBe(0)
      expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()

      resume(pauseKind)
      await advanceUntil(
        () => dailyRow('Calibrate sensors').queryByText('Ship materials: 260') !== null,
        'the resumed Daily award',
      )
      expect(shipRequests).toBe(1)
      expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
    },
  )

  it.each(['hidden', 'offline'] as const)(
    'starts repair readiness paused while %s and resumes when available',
    async (pauseKind) => {
      renderExpeditionRoute('/ship')
      await waitForShipPage()
      expect(materialsRegion().getByText('250')).toBeInTheDocument()
      const repair = screen.getByRole('button', { name: 'Repair Ship' })
      expect(repair).toBeEnabled()

      resetReadBookkeeping()
      balance = 246
      if (pauseKind === 'offline') {
        holdNextRepair = true
        fireEvent.click(repair)
        await advanceUntil(() => heldRepairStarted, 'the held repair response')
        pause(pauseKind)
        await act(async () => {
          releaseHeldRepair()
          await Promise.resolve()
        })
      } else {
        pause(pauseKind)
        fireEvent.click(repair)
      }
      await advanceUntil(
        () => screen.queryByText('The Ship was repaired.') !== null,
        'the repair success',
      )
      expect(screen.getByText('Updating…')).toBeInTheDocument()

      await advanceFakeTime(9_000)
      expect(shipRequests).toBe(0)
      expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
      expect(screen.getByText('Updating…')).toBeInTheDocument()

      resume(pauseKind)
      await advanceUntil(
        () => screen.queryByText('Updating…') === null,
        'the resumed repair readiness',
      )
      expect(shipRequests).toBe(1)
    },
  )

  it.each(['hidden', 'offline'] as const)(
    'holds the gate expiry read while %s and releases after availability returns',
    async (pauseKind) => {
      renderExpeditionRoute('/dashboard')
      await waitForDashboard()
      expect(materialsRegion().getByText('250')).toBeInTheDocument()

      resetReadBookkeeping()
      fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
      await advanceUntil(
        () => screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
        'the closed gate',
      )

      // Reach the final scheduled read and hold it, then pause while it is in
      // flight. Its settlement still expires the round, so the gate reaches a
      // new generation while reads are disallowed.
      await advanceFakeTime(4_500)
      holdNextShipRead = true
      await advanceFakeTime(3_500)
      await advanceUntil(() => heldShipReadStarted, 'the held final award read')
      pause(pauseKind)
      await advanceFakeTime(500)
      await act(async () => {
        releaseHeldShipRead()
        await Promise.resolve()
      })
      await advanceUntil(
        () => dailyRow('Calibrate sensors').queryByText('Update delayed') !== null,
        'the expired award',
      )

      const readsBeforePause = shipRequests
      await advanceFakeTime(10_000)
      expect(shipRequests).toBe(readsBeforePause)
      expect(screen.getAllByText('Checking the current Ship balance.').length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: 'Repair Ship' })).toBeDisabled()

      resume(pauseKind)
      await advanceUntil(
        () => !screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
        'the resumed gate read',
      )
      expect(shipRequests).toBe(readsBeforePause + 1)
    },
  )
})
