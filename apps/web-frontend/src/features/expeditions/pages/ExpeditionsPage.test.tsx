process.env.TZ = 'UTC'

import { act, fireEvent, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'

import { zExpeditionLaunchBody } from '@/api/generated/expedition/zod.gen'
import { createQueryClient } from '@/app/queryClient'
import { shipQueryKey } from '@/features/ship'
import {
  FIXED_MOCK_EPOCH_MS,
  ManualMockScheduler,
  createMockTestServer,
  createHealthyShip,
  fixedUuid,
  onUnhandledMockRequest,
} from '@/mocks'
import { renderAppAt } from '@/test/renderApp'
import { renderExpeditionRoute } from '@/test/renderExpeditionRoute'
import { advanceFakeTime, advanceUntil, seedAuthenticatedSession } from '@/test/expeditionTestUtils'
import { enableFakeTimers } from '@/test/fakeTimers'
import {
  clearDownstreamObservations,
  registerBalanceGateKey,
  registerDownstreamObservation,
} from '@/shared/reconciliation'

import type { MockTestServer } from '@/mocks'

const HOUR = 60 * 60 * 1000

let server: MockTestServer
let scheduler: ManualMockScheduler

function setVisibility(visible: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (visible ? 'visible' : 'hidden'),
  })
}

beforeEach(async () => {
  clearDownstreamObservations()
  scheduler = new ManualMockScheduler(FIXED_MOCK_EPOCH_MS)
  server = createMockTestServer({ scenario: 'established-player', scheduler })
  server.server.listen({ onUnhandledRequest: onUnhandledMockRequest })
  window.localStorage.clear()
  // Mock only Date (not timers): lazy routes and RTL waitFor keep working,
  // while counts and reconciliation reads stay anchored at the fixed epoch.
  vi.setSystemTime(new Date(FIXED_MOCK_EPOCH_MS))
  setVisibility(true)
  await seedAuthenticatedSession()
})

afterEach(() => {
  act(() => {
    clearDownstreamObservations()
  })
  vi.useRealTimers()
  setVisibility(true)
  server.server.resetHandlers()
  server.server.close()
})

/** Switches to full fake timers (anchored at the fixed epoch) to drive reconciliation reads. */
function enableReconciliationTimers(): void {
  enableFakeTimers(FIXED_MOCK_EPOCH_MS)
}

async function renderOverview(): Promise<void> {
  renderAppAt('/expeditions')
  await screen.findByRole('heading', { level: 1, name: 'Expeditions' })
}

/**
 * Fake-timer variant (see renderExpeditionRoute.tsx): journeys whose timers
 * (the resolve-derived poll, countdown ticks, stale-refresh) are scheduled at
 * mount need fake timers from the very first render.
 */
async function renderOverviewFake(queryClient?: QueryClient): Promise<void> {
  enableReconciliationTimers()
  renderExpeditionRoute('/expeditions', queryClient)
  await advanceUntil(
    () => screen.queryByRole('heading', { level: 1, name: 'Expeditions' }) !== null,
    'the Expeditions page heading',
  )
}

function changeInvestment(value: string): void {
  fireEvent.change(screen.getByLabelText('Materials to invest'), { target: { value } })
}

describe('Expeditions overview — launch form', () => {
  it('blocks launch with an accessible reason while the Daily balance updates', async () => {
    await renderOverviewFake()
    await advanceUntil(() => screen.queryByText('You have 250 materials') !== null, 'balance')
    changeInvestment('40')
    await advanceUntil(() => screen.queryByText('Ready to launch.') !== null, 'quote')
    act(() => {
      registerBalanceGateKey('daily:pending:award')
      registerDownstreamObservation({
        key: 'daily:pending:award',
        read: () => new Promise(() => {}),
        isSatisfied: () => false,
        publish: () => {},
      })
    })
    const launch = screen.getByRole('button', { name: 'Launch Expedition' })
    expect(launch).toBeDisabled()
    expect(launch).toHaveAccessibleDescription(/balance is updating/i)
  })

  it('compares a fast deduction with the balance from before submitting the launch', async () => {
    const queryClient = createQueryClient()
    let launched = false
    let releaseLaunch = () => {}
    const responseGate = new Promise<void>((resolve) => {
      releaseLaunch = resolve
    })
    server.server.use(
      http.post('/api/expedition/expeditions/launch', async ({ request }) => {
        const token = /^Bearer (.+)$/u.exec(request.headers.get('Authorization') ?? '')?.[1]
        const body = zExpeditionLaunchBody.parse(await request.json())
        const expedition = server.backend.launchExpedition(token, {
          materials_invested: Number(body.materials_invested),
        })
        launched = true
        await responseGate
        return HttpResponse.json(expedition, { status: 201 })
      }),
    )
    await renderOverviewFake(queryClient)
    await advanceUntil(() => screen.queryByText('You have 250 materials') !== null, 'balance')
    changeInvestment('40')
    await advanceUntil(() => screen.queryByText('Ready to launch.') !== null, 'quote')
    fireEvent.click(screen.getByRole('button', { name: 'Launch Expedition' }))
    await advanceUntil(() => launched, 'held launch response')
    scheduler.advance(2_001)
    act(() => {
      queryClient.setQueryData(shipQueryKey, {
        kind: 'ready',
        ship: createHealthyShip({ materials_balance: 210 }),
      })
      releaseLaunch()
    })
    await advanceUntil(() => screen.queryByText(/Available materials: 210/) !== null, 'deduction')
    await advanceFakeTime(200)
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
  })

  it('does not confirm a deduction from retained data after Ship refresh fails', async () => {
    const queryClient = createQueryClient()
    let fail = false
    server.server.use(
      http.get('/api/ship/ships/me', () =>
        fail ? HttpResponse.error() : HttpResponse.json(createHealthyShip()),
      ),
      http.post('/api/expedition/expeditions/launch', () => {
        fail = true
      }),
    )
    await renderOverviewFake(queryClient)
    await advanceUntil(() => screen.queryByText('You have 250 materials') !== null, 'balance')
    changeInvestment('40')
    await advanceUntil(() => screen.queryByText('Ready to launch.') !== null, 'quote')
    fireEvent.click(screen.getByRole('button', { name: 'Launch Expedition' }))
    await advanceUntil(() => screen.queryByText('Expedition in flight') !== null, 'launch')
    act(() => {
      queryClient.setQueryData(shipQueryKey, {
        kind: 'ready',
        ship: createHealthyShip({ materials_balance: 200 }),
      })
    })
    await advanceUntil(
      () => screen.queryByText(/Available materials: 200/) !== null,
      'retained balance',
    )
    await advanceFakeTime(2_000)
    expect(screen.getByText('Updating…')).toBeInTheDocument()
    await advanceFakeTime(9_000)
    expect(screen.getByText(/Available materials: 200/)).toBeInTheDocument()
    expect(screen.getByText('Update delayed')).toBeInTheDocument()
  })
  it('keeps the original threshold across navigation, delayed Retry, awards and spending', async () => {
    let balance = 250
    let reads = 0
    let launches = 0
    server.server.use(
      http.get('/api/ship/ships/me', () => {
        reads += 1
        return HttpResponse.json(createHealthyShip({ materials_balance: balance }))
      }),
      http.post('/api/expedition/expeditions/launch', () => {
        launches += 1
      }),
    )
    await renderOverviewFake()
    await advanceUntil(() => screen.queryByText('You have 250 materials') !== null, 'balance')
    changeInvestment('40')
    await advanceUntil(() => screen.queryByText('Ready to launch.') !== null, 'quote')
    fireEvent.click(screen.getByRole('button', { name: 'Launch Expedition' }))
    await advanceUntil(() => screen.queryByText('Expedition in flight') !== null, 'launch')
    balance = 230 // A concurrent award can mask part of the 40-material deduction.
    await advanceFakeTime(1_500)
    expect(screen.getByText('Updating…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'View history' }))
    await advanceUntil(() => screen.queryByText('Expedition in flight') === null, 'history')
    await advanceFakeTime(500)
    const pausedReads = reads
    await advanceFakeTime(10_000)
    expect(reads).toBe(pausedReads)
    fireEvent.click(screen.getByRole('link', { name: 'Overview' }))
    await advanceUntil(() => screen.queryByText('Expedition in flight') !== null, 'overview')
    expect(screen.getByText('Updating…')).toBeInTheDocument()
    await advanceFakeTime(8_500)
    expect(screen.getByText('Update delayed')).toBeInTheDocument()
    balance = 205 // Subsequent repair spending crosses the original threshold (210).
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await advanceUntil(
      () => screen.queryByText(/Available materials: 205/) !== null,
      'fresh balance',
    )
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
    expect(launches).toBe(1)
  })
  it('does not invent a deduction baseline when the initial Ship read fails', async () => {
    let fail = true
    server.server.use(
      http.get('/api/ship/ships/me', () =>
        fail
          ? HttpResponse.error()
          : HttpResponse.json(createHealthyShip({ materials_balance: 210 })),
      ),
      http.post('/api/expedition/expeditions/launch', () => {
        fail = false
      }),
    )
    await renderOverviewFake()
    await advanceUntil(
      () => screen.queryByRole('heading', { name: 'Launch an Expedition' }) !== null,
      'launch form',
    )
    await advanceFakeTime(3_000)
    changeInvestment('40')
    await advanceUntil(() => screen.queryByText('Ready to launch.') !== null, 'quote')
    fireEvent.click(screen.getByRole('button', { name: 'Launch Expedition' }))
    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the in-flight view',
    )
    expect(screen.getByText('Updating…')).toBeInTheDocument()
    await advanceFakeTime(8_500)
    expect(screen.getByText('Update delayed')).toBeInTheDocument()
    expect(screen.getByText(/Available materials: 210/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await advanceFakeTime(8_500)
    expect(screen.getByText('Update delayed')).toBeInTheDocument()
  })

  it('clears a pending deduction at the session boundary', async () => {
    await renderOverviewFake()
    await advanceUntil(() => screen.queryByText('You have 250 materials') !== null, 'balance')
    changeInvestment('40')
    await advanceUntil(() => screen.queryByText('Ready to launch.') !== null, 'quote')
    fireEvent.click(screen.getByRole('button', { name: 'Launch Expedition' }))
    await advanceUntil(() => screen.queryByText('Updating…') !== null, 'deduction')
    act(() => {
      clearDownstreamObservations()
    })
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
    await advanceFakeTime(9_000)
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
  })
  it('shows the exact balance, shortcuts, and a live quote for the investment', async () => {
    await renderOverview()

    await screen.findByText('You have 250 materials')
    expect(screen.getByRole('heading', { name: 'Launch an Expedition' })).toBeInTheDocument()

    changeInvestment('40')

    await screen.findByText('Projected balance')
    expect(screen.getByText('210 materials')).toBeInTheDocument()
    // With the backend formula: normalizedInvestment * (hullHealth / 100)
    // where normalizedInvestment = materials / (materials + 10),
    // 40 materials with hull_health=96 gives 0.8 * 0.96 = 0.768 = 77%.
    expect(screen.getByText('77%')).toBeInTheDocument()
    // The resolve window is 7 days from now with ±12 hour jitter.
    expect(screen.getByText(/Around .*9:00 AM, within ±12 h/)).toBeInTheDocument()
    expect(screen.getByText('Ready to launch.')).toBeInTheDocument()

    const min = screen.getByRole('button', { name: 'Min' })
    const quarter = screen.getByRole('button', { name: '25%' })
    const half = screen.getByRole('button', { name: '50%' })
    const max = screen.getByRole('button', { name: 'Max' })
    fireEvent.click(max)
    expect(screen.getByLabelText('Materials to invest')).toHaveValue(250)
    expect(max).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(min)
    expect(screen.getByLabelText('Materials to invest')).toHaveValue(1)
    expect(min).toHaveAttribute('aria-pressed', 'true')
    await screen.findByText('Ready to launch.')
    // 25% of 250 rounds to 63 and 50% to 125.
    fireEvent.click(quarter)
    expect(screen.getByLabelText('Materials to invest')).toHaveValue(63)
    fireEvent.click(half)
    expect(screen.getByLabelText('Materials to invest')).toHaveValue(125)
  })

  it('launches pessimistically and reconciles the Ship deduction until observed', async () => {
    await renderOverview()
    await screen.findByText('You have 250 materials')
    changeInvestment('40')
    await screen.findByText('Ready to launch.')
    enableReconciliationTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Launch Expedition' }))

    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the in-flight view',
    )
    expect(screen.getByRole('heading', { name: 'Expedition in flight' })).toBeInTheDocument()
    // The resolve time is 7 days from the fixed epoch (January 15, 2026 9:00 AM UTC).
    expect(screen.getByText(/Resolves at .*9:00 AM/)).toBeInTheDocument()
    expect(screen.getByText('40 materials')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View Expedition detail' })).toHaveAttribute(
      'href',
      `/expeditions/${fixedUuid(7, 3)}`,
    )
    expect(screen.getByRole('link', { name: 'View history' })).toHaveAttribute(
      'href',
      '/expeditions/history',
    )

    // The immediate and 1s/2s reads see the untouched balance: Updating… stays
    // adjacent to the materials value (§3.4).
    expect(screen.getByText('Updating…')).toBeInTheDocument()
    await advanceFakeTime(3_100)
    expect(screen.getByText('Updating…')).toBeInTheDocument()
    expect(screen.getByText(/Available materials: 250/)).toBeInTheDocument()

    // The mock applies the deduction after its propagation window; the next
    // read observes it and the sync stops.
    scheduler.advance(2_001)
    await advanceUntil(
      () => screen.queryByText(/Available materials: 210/) !== null,
      'the deduction to land',
    )
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
  })

  it('pauses reconciliation reads while hidden and resumes without burning budget', async () => {
    await renderOverview()
    await screen.findByText('You have 250 materials')
    changeInvestment('40')
    await screen.findByText('Ready to launch.')
    enableReconciliationTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Launch Expedition' }))
    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the in-flight view',
    )
    await advanceUntil(() => screen.queryByText('Updating…') !== null, 'the updating badge')
    expect(screen.getByText(/Available materials: 250/)).toBeInTheDocument()

    // Hidden for 10s: the 1/2/4/8s budget must not burn or expire (§3.2).
    setVisibility(false)
    await advanceFakeTime(10_000)
    expect(screen.getByText('Updating…')).toBeInTheDocument()
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
    expect(screen.getByText(/Available materials: 250/)).toBeInTheDocument()

    // Visible again with the deduction available: the first marked read lands.
    scheduler.advance(2_001)
    setVisibility(true)
    await advanceUntil(
      () => screen.queryByText(/Available materials: 210/) !== null,
      'the deduction to land after resume',
    )
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
  })

  it('expires into Update delayed with a local Retry when the deduction never lands', async () => {
    server.reset('delayed-propagation')
    await seedAuthenticatedSession()
    await renderOverview()
    await screen.findByText('You have 250 materials')
    changeInvestment('40')
    await screen.findByText('Ready to launch.')
    enableReconciliationTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Launch Expedition' }))
    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the in-flight view',
    )
    expect(screen.getByText('Updating…')).toBeInTheDocument()

    // The consumer never catches up, so the bounded schedule expires.
    scheduler.advance(5 * 60 * 1000 + 1)
    await advanceFakeTime(8_500)
    expect(screen.getByText('Update delayed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByText(/Available materials: 250/)).toBeInTheDocument()

    // A player-initiated Retry re-runs the bounded schedule; still stale.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await advanceFakeTime(8_500)
    expect(screen.getByText('Update delayed')).toBeInTheDocument()
  })

  it('surfaces a launch conflict and never replays the launch automatically', async () => {
    let launchCalls = 0
    server.server.use(
      http.post('/api/expedition/expeditions/launch', () => {
        launchCalls += 1
        return HttpResponse.json(
          {
            error: {
              code: 'EXPEDITION_ALREADY_ACTIVE',
              message: 'Another Expedition is already in flight.',
            },
          },
          { status: 409 },
        )
      }),
    )
    await renderOverview()
    await screen.findByText('You have 250 materials')
    changeInvestment('40')
    await screen.findByText('Ready to launch.')
    enableReconciliationTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Launch Expedition' }))

    await advanceUntil(
      () => screen.queryByText(/Another Expedition started before yours/) !== null,
      'the conflict message',
    )
    expect(screen.getByRole('button', { name: 'Try launching again' })).toBeInTheDocument()
    expect(launchCalls).toBe(1)
    await advanceFakeTime(3_000)
    expect(launchCalls).toBe(1)

    // The explicit player-initiated retry succeeds once the conflict clears.
    server.server.resetHandlers()
    fireEvent.click(screen.getByRole('button', { name: 'Try launching again' }))
    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the retried launch',
    )
  })

  it('turns an insufficient-materials rejection into a player-initiated retry', async () => {
    let launchCalls = 0
    server.server.use(
      http.post('/api/expedition/expeditions/launch', () => {
        launchCalls += 1
        return HttpResponse.json(
          {
            error: { code: 'EXPEDITION_INSUFFICIENT_MATERIALS', message: 'Not enough materials.' },
          },
          { status: 422 },
        )
      }),
    )
    await renderOverview()
    await screen.findByText('You have 250 materials')
    changeInvestment('40')
    await screen.findByText('Ready to launch.')
    enableReconciliationTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Launch Expedition' }))

    await advanceUntil(
      () => screen.queryByText(/You do not have enough materials to invest that amount/) !== null,
      'the retryable rejection message',
    )
    expect(screen.getByRole('button', { name: 'Try launching again' })).toBeInTheDocument()
    expect(launchCalls).toBe(1)
    await advanceFakeTime(3_000)
    expect(launchCalls).toBe(1)

    // Facts were refreshed and the player-initiated retry launches successfully.
    server.server.resetHandlers()
    fireEvent.click(screen.getByRole('button', { name: 'Try launching again' }))
    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the retried launch',
    )
  })

  it('detects an out-of-date quote from the post-revalidation data', async () => {
    let quoteCalls = 0
    server.server.use(
      http.get('/api/expedition/expeditions/quote', ({ request }) => {
        quoteCalls += 1
        const materials = Number(new URL(request.url).searchParams.get('materials_invested'))
        return HttpResponse.json(quoteBody(materials, quoteCalls > 1))
      }),
    )
    await renderOverview()
    await screen.findByText('You have 250 materials')
    changeInvestment('40')
    await screen.findByText('Ready to launch.')
    enableReconciliationTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Launch Expedition' }))

    await advanceUntil(
      () => screen.queryByText(/Your quote is out of date/) !== null,
      'the stale-quote conflict',
    )
    expect(screen.getByRole('button', { name: 'Try launching again' })).toBeInTheDocument()
  })

  it('shows a retryable preparing quote when the quote endpoint is not ready', async () => {
    server.server.use(
      http.get('/api/expedition/expeditions/quote', () =>
        HttpResponse.json(
          { error: { code: 'EXPEDITION_SHIP_STATE_NOT_READY', message: 'Not ready yet.' } },
          { status: 503 },
        ),
      ),
    )
    await renderOverview()
    await screen.findByText('You have 250 materials')
    enableReconciliationTimers()
    changeInvestment('40')

    await advanceUntil(
      () => screen.queryAllByText('Preparing…').length > 0,
      'the preparing quote state',
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

describe('Expeditions overview — provisioning and failure', () => {
  it('shows a preparing state while Ship state provisions and recovers on Retry', async () => {
    server.reset('provisioning')
    await seedAuthenticatedSession()
    await renderOverview()

    await screen.findByText('Preparing your Expedition')
    expect(screen.getByText('Preparing…')).toBeInTheDocument()

    scheduler.advance(5_000)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('heading', { name: 'Launch an Expedition' })
  })

  it('shows a retryable unavailable state when the current request fails', async () => {
    server.server.use(http.get('/api/expedition/expeditions/current', () => HttpResponse.error()))
    await renderOverview()

    expect(
      await screen.findByText('Expeditions are unavailable', {}, { timeout: 3_000 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

describe('Expeditions overview — in flight and resolution', () => {
  it('exposes the remaining time to assistive tech without a live region', async () => {
    server.reset('active-expedition')
    await seedAuthenticatedSession()
    await renderOverviewFake()

    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the in-flight view',
    )
    // The visually-hidden label makes the ticking value readable by AT, while
    // the element is never a live region (ticks are never announced).
    expect(screen.getByText('Time remaining:')).toBeInTheDocument()
    expect(screen.getByText('1h 00m 00s')).toBeInTheDocument()

    await advanceFakeTime(60_000)
    expect(screen.getByText('59m 00s')).toBeInTheDocument()
    expect(screen.queryByText('1h 00m 00s')).not.toBeInTheDocument()
    expect(screen.queryByText('59m 00s', { selector: '[aria-live]' })).toBeNull()
    expect(screen.queryByText('Time remaining:', { selector: '[aria-live]' })).toBeNull()
  })

  it('shows a newly observed result with a one-time celebration and reconciles the Ship reward', async () => {
    server.reset('active-expedition')
    await seedAuthenticatedSession()
    await renderOverviewFake()

    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the in-flight view',
    )
    expect(screen.getByText(/Resolves at 10:00 AM/)).toBeInTheDocument()
    expect(screen.getByText('62%')).toBeInTheDocument()

    scheduler.advance(HOUR)
    await advanceFakeTime(60_050)

    await advanceUntil(
      () => screen.queryByText('Expedition resolved') !== null,
      'the resolved result',
      50,
      30,
    )
    // Comprehension never depends on the animation: the panel is present, and
    // the celebration class is applied only for the short newly-observed window.
    const panel = screen.getByRole('region', { name: 'Expedition resolved' })
    expect(panel).toBeInTheDocument()
    expect(panel.className).toMatch(/celebrate/)
    expect(screen.getByText('Success')).toBeInTheDocument()
    expect(screen.getByText('+80 materials')).toBeInTheDocument()

    await advanceFakeTime(500)
    const settledPanel = screen.getByRole('region', { name: 'Expedition resolved' })
    expect(settledPanel).toBeInTheDocument()
    expect(settledPanel.className).not.toMatch(/celebrate/)

    // Bounded reward reconciliation: +80 once the propagation window lands.
    expect(screen.getByText('Updating…')).toBeInTheDocument()
    scheduler.advance(2_001)
    await advanceUntil(
      () =>
        screen.queryByText(/Available materials: 330/) !== null &&
        screen.queryByText('You have 330 materials') !== null,
      'the reward to land',
    )
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
    expect(screen.getByText('You have 330 materials')).toBeInTheDocument()
  })

  it('confirms a fast reward against the balance held before the resolution', async () => {
    server.reset('active-expedition')
    await seedAuthenticatedSession()
    await renderOverviewFake()
    await advanceUntil(() => screen.queryByText('Expedition in flight') !== null, 'in flight')
    scheduler.advance(HOUR + 2_001)
    await advanceFakeTime(60_050)
    await advanceUntil(
      () =>
        screen.queryByText('Available materials: 330') !== null &&
        screen.queryByText('Updating…') === null,
      'fast reward',
    )
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
  })

  it('keeps stale in-flight data labelled Update delayed with a Retry when a refetch fails', async () => {
    server.reset('active-expedition')
    await seedAuthenticatedSession()
    await renderOverviewFake()

    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the in-flight view',
    )
    server.server.use(
      http.get('/api/expedition/expeditions/current', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Boom.' } }, { status: 500 }),
      ),
    )
    // The bounded poll fires one refetch that fails; the confirmed in-flight
    // state stays visible with a stale label and a local Retry (§3.2). The
    // auto-retry (1s) also fails before isRefetchError settles.
    await advanceFakeTime(60_050)
    await advanceUntil(
      () => screen.queryByText('Update delayed') !== null,
      'the stale label',
      50,
      80,
    )
    expect(screen.getByText('Expedition in flight')).toBeInTheDocument()
    expect(
      screen.getByText('Could not refresh. Showing the last confirmed state.'),
    ).toBeInTheDocument()

    server.server.resetHandlers()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await advanceUntil(
      () => screen.queryByText('Update delayed') === null,
      'the refresh to recover',
    )
    expect(screen.getByText('Expedition in flight')).toBeInTheDocument()
  })
})

function quoteBody(materialsInvested: number, ineligible: boolean) {
  const normalized = Math.min(1, materialsInvested / 250)
  return {
    materials_invested: materialsInvested,
    normalized_investment: ineligible ? 0 : normalized,
    projected_balance: 250 - materialsInvested,
    success_chance: ineligible ? 0 : Math.min(0.95, normalized * 0.95),
    eligible: !ineligible,
    blocker: ineligible ? 'EXPEDITION_ALREADY_ACTIVE' : null,
    cooldown_until: null,
    estimated_resolve_at: new Date(FIXED_MOCK_EPOCH_MS + HOUR).toISOString(),
    estimated_resolve_window_seconds: 3600,
  }
}
