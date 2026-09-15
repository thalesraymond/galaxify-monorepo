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
import { renderExpeditionRoute } from '@/test/renderExpeditionRoute'
import { advanceFakeTime, advanceUntil, seedAuthenticatedSession } from '@/test/expeditionTestUtils'

import type { MockTestServer } from '@/mocks'

const HOUR = 60 * 60 * 1000

let server: MockTestServer
let scheduler: ManualMockScheduler

beforeEach(async () => {
  scheduler = new ManualMockScheduler(FIXED_MOCK_EPOCH_MS)
  server = createMockTestServer({ scenario: 'established-player', scheduler })
  server.server.listen({ onUnhandledRequest: onUnhandledMockRequest })
  window.localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_MOCK_EPOCH_MS)
  await seedAuthenticatedSession()
})

afterEach(() => {
  vi.useRealTimers()
  server.server.resetHandlers()
  server.server.close()
})

async function renderOverview() {
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

    await advanceUntil(() => screen.queryByText('You have 250 materials') !== null, 'the balance')
    expect(screen.getByRole('heading', { name: 'Launch an Expedition' })).toBeInTheDocument()

    changeInvestment('40')

    await advanceUntil(() => screen.queryByText('Projected balance') !== null, 'the quote')
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
    await advanceUntil(() => screen.queryByText('Ready to launch.') !== null, 'a fresh quote')
    // 25% of 250 rounds to 63 and 50% to 125.
    fireEvent.click(quarter)
    expect(screen.getByLabelText('Materials to invest')).toHaveValue(63)
    fireEvent.click(half)
    expect(screen.getByLabelText('Materials to invest')).toHaveValue(125)
  })

  it('launches pessimistically and reconciles the Ship deduction until observed', async () => {
    await renderOverview()
    changeInvestment('40')
    await advanceUntil(() => screen.queryByText('Ready to launch.') !== null, 'an eligible quote')

    fireEvent.click(screen.getByRole('button', { name: 'Launch Expedition' }))

    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the in-flight view',
    )
    expect(screen.getByRole('heading', { name: 'Expedition in flight' })).toBeInTheDocument()
    expect(screen.getByLabelText('Time remaining')).toHaveTextContent(
      /^Resolves in(\d+h )?\d{2}m \d{2}s$/,
    )
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

    // The deduction lands after the mock propagation window; Updating… stays
    // adjacent to the materials value until it is observed (§3.4).
    expect(screen.getByText('Updating…')).toBeInTheDocument()
    scheduler.advance(2_001)
    await advanceUntil(() => screen.queryByText('Updating…') === null, 'the deduction to land')
    expect(screen.getByText(/Available materials: 210/)).toBeInTheDocument()
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
    changeInvestment('40')
    await advanceUntil(() => screen.queryByText('Ready to launch.') !== null, 'an eligible quote')

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

  it('keeps an insufficient-materials launch failure inline', async () => {
    server.server.use(
      http.post('/api/expedition/expeditions/launch', () =>
        HttpResponse.json(
          {
            error: { code: 'EXPEDITION_INSUFFICIENT_MATERIALS', message: 'Not enough materials.' },
          },
          { status: 422 },
        ),
      ),
    )
    await renderOverview()
    changeInvestment('40')
    await advanceUntil(() => screen.queryByText('Ready to launch.') !== null, 'an eligible quote')

    fireEvent.click(screen.getByRole('button', { name: 'Launch Expedition' }))

    await advanceUntil(
      () => screen.queryByText('You do not have enough materials to invest that amount.') !== null,
      'the inline blocker message',
    )
    expect(
      screen.getByText('You do not have enough materials to invest that amount.'),
    ).toBeInTheDocument()
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

    await advanceUntil(
      () => screen.queryByText('Preparing your Expedition') !== null,
      'the preparing state',
    )
    expect(screen.getByText('Preparing…')).toBeInTheDocument()

    scheduler.advance(5_000)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await advanceUntil(
      () => screen.queryByRole('heading', { name: 'Launch an Expedition' }) !== null,
      'the launch form after provisioning',
    )
  })

  it('shows a retryable unavailable state when the current request fails', async () => {
    server.server.use(http.get('/api/expedition/expeditions/current', () => HttpResponse.error()))
    await renderOverview()

    await advanceUntil(
      () => screen.queryByText('Expeditions are unavailable') !== null,
      'the unavailable state',
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

describe('Expeditions overview — in flight and resolution', () => {
  it('ticks the countdown without announcing ticks in a live region', async () => {
    server.reset('active-expedition')
    await seedAuthenticatedSession()
    await renderOverview()

    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the in-flight view',
    )
    const countdown = screen.getByLabelText('Time remaining')
    const before = countdown.textContent

    await advanceFakeTime(60_000)
    expect(countdown.textContent).not.toBe(before)
    expect(countdown.textContent).toMatch(/^Resolves in5\dm \d{2}s$/)

    // No live region announces the ticking countdown.
    expect(screen.queryByText(countdown.textContent, { selector: '[aria-live]' })).toBeNull()
    expect(screen.queryByText('Resolves in', { selector: '[aria-live]' })).toBeNull()
  })

  it('shows a newly observed result with a one-time celebration and reconciles the Ship reward', async () => {
    server.reset('active-expedition')
    await seedAuthenticatedSession()
    await renderOverview()

    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the in-flight view',
    )
    expect(screen.getByText(/Resolves at 10:00 AM/)).toBeInTheDocument()
    expect(screen.getByText('62%')).toBeInTheDocument()

    // Cross the fixed resolve time in the backend, then let one bounded poll
    // observe the typed `none` transition.
    scheduler.advance(HOUR)
    await advanceFakeTime(60_050)

    await advanceUntil(
      () => screen.queryByText('Expedition resolved') !== null,
      'the resolved result',
      50,
      30,
    )
    expect(screen.getByText('Success')).toBeInTheDocument()
    expect(screen.getByText('+80 materials')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Expedition resolved' })).toHaveAttribute(
      'data-celebrate',
      'true',
    )

    // The celebration is not replayed after its 450 ms window.
    await advanceFakeTime(500)
    expect(
      screen.getByRole('region', { name: 'Expedition resolved' }).getAttribute('data-celebrate'),
    ).not.toBe('true')

    // Bounded reward reconciliation: +80 once the propagation window lands.
    expect(screen.getByText('Updating…')).toBeInTheDocument()
    scheduler.advance(2_001)
    await advanceUntil(() => screen.queryByText('Updating…') === null, 'the reward to land')
    expect(screen.getByText(/Available materials: 330/)).toBeInTheDocument()
    expect(screen.getByText('You have 330 materials')).toBeInTheDocument()
  })
})
