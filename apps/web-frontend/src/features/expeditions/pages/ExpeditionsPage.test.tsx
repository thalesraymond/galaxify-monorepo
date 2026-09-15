process.env.TZ = 'UTC'

import { fireEvent, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FIXED_MOCK_EPOCH_MS,
  ManualMockScheduler,
  createMockTestServer,
  fixedUuid,
  onUnhandledMockRequest,
} from '@/mocks'
import { renderAppAt } from '@/test/renderApp'
import { renderExpeditionRoute } from '@/test/renderExpeditionRoute'
import { advanceFakeTime, advanceUntil, seedAuthenticatedSession } from '@/test/expeditionTestUtils'

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
  scheduler = new ManualMockScheduler(FIXED_MOCK_EPOCH_MS)
  server = createMockTestServer({ scenario: 'established-player', scheduler })
  server.server.listen({ onUnhandledRequest: onUnhandledMockRequest })
  window.localStorage.clear()
  // Mock only Date (not timers): lazy routes and RTL waitFor keep working,
  // while counts and probes stay anchored at the fixed epoch.
  vi.setSystemTime(new Date(FIXED_MOCK_EPOCH_MS))
  setVisibility(true)
  await seedAuthenticatedSession()
})

afterEach(() => {
  vi.useRealTimers()
  setVisibility(true)
  server.server.resetHandlers()
  server.server.close()
})

/** Switches to full fake timers (anchored at the fixed epoch) to drive probes. */
function enableProbeTimers(): void {
  vi.useFakeTimers({ now: new Date(FIXED_MOCK_EPOCH_MS) })
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
async function renderOverviewFake(): Promise<void> {
  enableProbeTimers()
  renderExpeditionRoute('/expeditions')
  await advanceUntil(
    () => screen.queryByRole('heading', { level: 1, name: 'Expeditions' }) !== null,
    'the Expeditions page heading',
  )
}

function changeInvestment(value: string): void {
  fireEvent.change(screen.getByLabelText('Materials to invest'), { target: { value } })
}

describe('Expeditions overview — launch form', () => {
  it('shows the exact balance, shortcuts, and a live quote for the investment', async () => {
    await renderOverview()

    await screen.findByText('You have 250 materials')
    expect(screen.getByRole('heading', { name: 'Launch an Expedition' })).toBeInTheDocument()

    changeInvestment('40')

    await screen.findByText('Projected balance')
    expect(screen.getByText('210 materials')).toBeInTheDocument()
    expect(screen.getByText('15%')).toBeInTheDocument()
    expect(screen.getByText(/Around 10:00 AM, within ±30 min/)).toBeInTheDocument()
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
    enableProbeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Launch Expedition' }))

    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the in-flight view',
    )
    expect(screen.getByRole('heading', { name: 'Expedition in flight' })).toBeInTheDocument()
    expect(screen.getByText(/Resolves at 10:00 AM/)).toBeInTheDocument()
    expect(screen.getByText('40 materials')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View Expedition detail' })).toHaveAttribute(
      'href',
      `/expeditions/${fixedUuid(7, 3)}`,
    )
    expect(screen.getByRole('link', { name: 'View history' })).toHaveAttribute(
      'href',
      '/expeditions/history',
    )

    // The immediate and 1s/2s probes see the untouched balance: Updating… stays
    // adjacent to the materials value (§3.4).
    expect(screen.getByText('Updating…')).toBeInTheDocument()
    await advanceFakeTime(3_100)
    expect(screen.getByText('Updating…')).toBeInTheDocument()
    expect(screen.getByText(/Available materials: 250/)).toBeInTheDocument()

    // The mock applies the deduction after its propagation window; the next
    // probe observes it and the sync stops.
    scheduler.advance(2_001)
    await advanceUntil(
      () => screen.queryByText(/Available materials: 210/) !== null,
      'the deduction to land',
    )
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
  })

  it('pauses the probe schedule while hidden and resumes without burning budget', async () => {
    await renderOverview()
    await screen.findByText('You have 250 materials')
    changeInvestment('40')
    await screen.findByText('Ready to launch.')
    enableProbeTimers()

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

    // Visible again with the deduction available: the first mark probe lands.
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
    enableProbeTimers()

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
    enableProbeTimers()

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
    enableProbeTimers()

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
    enableProbeTimers()

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
    enableProbeTimers()
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
      () => screen.queryByText(/Available materials: 330/) !== null,
      'the reward to land',
    )
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
    expect(screen.getByText('You have 330 materials')).toBeInTheDocument()
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
