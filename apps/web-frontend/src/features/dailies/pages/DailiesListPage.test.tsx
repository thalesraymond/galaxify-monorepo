process.env.TZ = 'UTC'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppProviders } from '@/app/providers'
import { routes } from '@/app/routes'
import { SESSION_REFRESH_STORAGE_KEY } from '@/features/auth'
import { createMockTestServer, onUnhandledMockRequest } from '@/mocks'
import { ManualMockScheduler } from '@/mocks/clock'
import { createHealthyShip, FIXED_DAILY_IDS, FIXED_MOCK_EPOCH_MS } from '@/mocks/fixtures'
import { renderAppAt } from '@/test/renderApp'

const scheduler = new ManualMockScheduler(FIXED_MOCK_EPOCH_MS)
const server = createMockTestServer({ scenario: 'established-player', scheduler })

beforeAll(() => {
  server.server.listen({ onUnhandledRequest: onUnhandledMockRequest })
})

afterEach(() => {
  server.server.resetHandlers()
  server.reset('established-player')
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  })
  vi.useRealTimers()
})

afterAll(() => {
  server.stop()
})

beforeEach(async () => {
  window.localStorage.clear()
  vi.setSystemTime(new Date(FIXED_MOCK_EPOCH_MS))
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  })
  await seedAuthenticatedSession()
})

async function seedAuthenticatedSession(): Promise<void> {
  const response = await fetch('/api/user/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'captain@galaxify.test', password: 'password123' }),
  })
  const body = (await response.json()) as { refresh_token: string }
  window.localStorage.setItem(
    SESSION_REFRESH_STORAGE_KEY,
    JSON.stringify({ version: 1, refreshToken: body.refresh_token }),
  )
}

async function renderDailies(): Promise<void> {
  renderAppAt('/dailies')
  expect(await screen.findByRole('heading', { level: 1, name: 'Dailies' })).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'Calibrate sensors' })).toBeInTheDocument()
}

/**
 * Completion/reconciliation tests render and settle the first load with real
 * timers (RTL waitFor does not auto-advance Vitest fake timers), then switch
 * to fake timers to drive the bounded probe schedule deterministically.
 */
function enableProbeTimers(): void {
  vi.useFakeTimers({ now: new Date(FIXED_MOCK_EPOCH_MS) })
}

async function flushProbes(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }
}

/** Advances the frontend probe clock inside act so state updates flush. */
async function advanceClock(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('/dailies current list', () => {
  it('defaults to the browser-local date and shows today’s Dailies', async () => {
    await renderDailies()

    expect(screen.getByLabelText('Date')).toHaveValue('2026-01-15')
    expect(await screen.findByRole('heading', { name: 'Calibrate sensors' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Stretch the solar sails' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Hydrate the coolant loop' })).toBeInTheDocument()

    // Rows show due-time context and difficulty/stakes from the metadata.
    expect(screen.getByText('10:00 (UTC)')).toBeInTheDocument()
    expect(screen.getByText('EASY · +10 materials')).toBeInTheDocument()
    expect(screen.getByText('HARD · +50 materials')).toBeInTheDocument()

    // Completed rows sit in a collapsible section.
    expect(screen.getByText('Completed (1)')).toBeInTheDocument()
  })

  it('navigates between days with previous/next/Today and a date input', async () => {
    const user = userEvent.setup()
    await renderDailies()

    await user.click(screen.getByRole('button', { name: 'Next day' }))
    expect(screen.getByLabelText('Date')).toHaveValue('2026-01-16')
    expect(await screen.findByRole('heading', { name: 'No Dailies' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'There are no Dailies for January 16, 2026. Create one to start a recurring responsibility.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create Daily' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(await screen.findByRole('heading', { name: 'Calibrate sensors' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next day' }))
    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(await screen.findByRole('heading', { name: 'Calibrate sensors' })).toBeInTheDocument()
    expect(screen.getByLabelText('Date')).toHaveValue('2026-01-15')

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-01-14' } })
    expect(await screen.findByRole('heading', { name: 'No Dailies' })).toBeInTheDocument()
    expect(screen.getByLabelText('Date')).toHaveValue('2026-01-14')
  })

  it('filters by status with a pressed toggle group', async () => {
    const user = userEvent.setup()
    await renderDailies()

    const pending = screen.getByRole('button', { name: 'Pending' })
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(pending)
    expect(pending).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Calibrate sensors' })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Hydrate the coolant loop' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Completed' }))
    expect(screen.getByRole('heading', { name: 'Hydrate the coolant loop' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Calibrate sensors' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(await screen.findByRole('heading', { name: 'Calibrate sensors' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Hydrate the coolant loop' })).toBeInTheDocument()
  })
})

describe('/dailies completion and Ship reconciliation', () => {
  it('completes optimistically, announces the typed award, and reconciles Ship', async () => {
    await renderDailies()
    enableProbeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    await flushProbes()

    // Optimistic: the row is completed and its control is disabled.
    expect(screen.getByText('Completed · +10 materials')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Complete Calibrate sensors' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Calibrate sensors completed. +10 materials awarded.'),
    ).toBeInTheDocument()

    // The mock materializes the award after its 2s window; the probe at ~2s
    // observes the increased balance and stops.
    scheduler.advance(1_000)
    await advanceClock(1_000)
    await flushProbes()
    expect(screen.getByText('Ship materials: 250')).toBeInTheDocument()
    scheduler.advance(1_000)
    await advanceClock(1_000)
    await flushProbes()
    expect(screen.getByText('Ship materials: 260')).toBeInTheDocument()
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
  })

  it('pauses reconciliation while the tab is hidden and resumes when visible', async () => {
    await renderDailies()
    enableProbeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    await flushProbes()
    expect(screen.getByText('Ship materials: 250')).toBeInTheDocument()

    // Hide the tab: the probe schedule pauses and cannot advance.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    scheduler.advance(10_000)
    await advanceClock(10_000)
    await flushProbes()
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
    expect(screen.getByText('Ship materials: 250')).toBeInTheDocument()

    // Show the tab again: the next probe resumes and reconciles.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    scheduler.advance(1_000)
    document.dispatchEvent(new Event('visibilitychange'))
    await advanceClock(1_000)
    await flushProbes()
    scheduler.advance(1_000)
    await advanceClock(1_000)
    await flushProbes()
    expect(screen.getByText('Ship materials: 260')).toBeInTheDocument()
  })

  it('pauses reconciliation while offline and resumes when online', async () => {
    await renderDailies()
    const onlineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine')
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    try {
      enableProbeTimers()
      fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
      await flushProbes()
      expect(screen.getByText('Ship materials: 250')).toBeInTheDocument()

      window.dispatchEvent(new Event('offline'))
      scheduler.advance(10_000)
      await advanceClock(10_000)
      await flushProbes()
      expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()

      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
      scheduler.advance(1_000)
      window.dispatchEvent(new Event('online'))
      await advanceClock(1_000)
      await flushProbes()
      scheduler.advance(1_000)
      await advanceClock(1_000)
      await flushProbes()
      expect(screen.getByText('Ship materials: 260')).toBeInTheDocument()
    } finally {
      if (onlineDescriptor !== undefined) {
        Object.defineProperty(navigator, 'onLine', onlineDescriptor)
      } else {
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
      }
    }
  })

  it('shows Update delayed after the window elapses with Retry', async () => {
    server.reset('delayed-propagation')
    await seedAuthenticatedSession()
    await renderDailies()
    enableProbeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    await flushProbes()
    expect(screen.getByText('Ship materials: 250')).toBeInTheDocument()

    // Advance through the 1/2/4/8s schedule; the 5-minute window never elapses.
    scheduler.advance(1_000)
    await advanceClock(1_000)
    scheduler.advance(1_000)
    await advanceClock(1_000)
    scheduler.advance(2_000)
    await advanceClock(2_000)
    scheduler.advance(4_000)
    await advanceClock(4_000)
    await flushProbes()

    expect(screen.getByText('Update delayed')).toBeInTheDocument()
    expect(screen.getByText('Ship materials: 250')).toBeInTheDocument()
    expect(
      screen.getByText('Ship materials update is delayed for Calibrate sensors.'),
    ).toBeInTheDocument()

    // A local Retry restarts the bounded window; still nothing propagates.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await flushProbes()
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
    scheduler.advance(1_000)
    await advanceClock(1_000)
    scheduler.advance(1_000)
    await advanceClock(1_000)
    scheduler.advance(2_000)
    await advanceClock(2_000)
    scheduler.advance(4_000)
    await advanceClock(4_000)
    await flushProbes()
    expect(screen.getByText('Update delayed')).toBeInTheDocument()
  })

  it('rolls back a failed completion in place with a row Retry', async () => {
    const user = userEvent.setup()
    await renderDailies()

    server.server.use(
      http.post('/api/daily/dailies/:id/complete', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Completion exploded.' } },
          { status: 500 },
        ),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    expect(await screen.findByText('Completion exploded.')).toBeInTheDocument()
    // The row is restored in place with its completion control back.
    expect(screen.getByRole('button', { name: 'Complete Calibrate sensors' })).toBeInTheDocument()
    expect(
      screen.getByText('Could not complete Calibrate sensors. It remains pending.'),
    ).toBeInTheDocument()

    // The row-level Retry succeeds once the server recovers.
    server.server.resetHandlers()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.getByText('Completed · +10 materials')).toBeInTheDocument()
  })

  it('settles as completed on DAILY_ALREADY_COMPLETED after rollback and reconciles', async () => {
    await renderDailies()

    // Another writer completes the Daily after the page loaded.
    const session = await fetch('/api/user/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'captain@galaxify.test', password: 'password123' }),
    })
    const sessionBody = (await session.json()) as { access_token: string }
    server.backend.completeDaily(sessionBody.access_token, FIXED_DAILY_IDS.calibrate)

    enableProbeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    await flushProbes()
    await flushProbes()

    // The refetch settles the row as completed and reconciliation runs.
    expect(screen.getByText('Completed · +10 materials')).toBeInTheDocument()
    scheduler.advance(1_000)
    await advanceClock(1_000)
    await flushProbes()
    scheduler.advance(1_000)
    await advanceClock(1_000)
    await flushProbes()
    expect(screen.getByText('Ship materials: 260')).toBeInTheDocument()
  })

  it('reconciles two completed rows independently (per-row sessions)', async () => {
    await renderDailies()
    enableProbeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    fireEvent.click(screen.getByRole('button', { name: 'Complete Stretch the solar sails' }))
    await flushProbes()
    expect(screen.getByText('Completed · +10 materials')).toBeInTheDocument()
    expect(screen.getByText('Completed · +50 materials')).toBeInTheDocument()

    // The mock materializes the last completion's award (+50) after its 2s
    // window; both rows observe it on their own schedules and stop ready.
    scheduler.advance(1_000)
    await advanceClock(1_000)
    await flushProbes()
    scheduler.advance(1_000)
    await advanceClock(1_000)
    await flushProbes()

    expect(screen.getAllByText('Ship materials: 300')).toHaveLength(2)
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
    expect(screen.queryByText(/Updating…/)).not.toBeInTheDocument()
  })

  it('reaches Update delayed with Retry on every completed row', async () => {
    server.reset('delayed-propagation')
    await seedAuthenticatedSession()
    await renderDailies()
    enableProbeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    fireEvent.click(screen.getByRole('button', { name: 'Complete Stretch the solar sails' }))
    await flushProbes()

    // Advance through the full 1/2/4/8s schedule; the 5-minute window never
    // elapses, so every completed row must surface the delayed state.
    scheduler.advance(1_000)
    await advanceClock(1_000)
    scheduler.advance(1_000)
    await advanceClock(1_000)
    scheduler.advance(2_000)
    await advanceClock(2_000)
    scheduler.advance(4_000)
    await advanceClock(4_000)
    await flushProbes()

    expect(screen.getAllByText('Update delayed')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(2)
    expect(screen.queryByText(/Updating…/)).not.toBeInTheDocument()
  })

  it('stops only on the expected award, not on unrelated small movements', async () => {
    let shipCalls = 0
    server.server.use(
      http.get('/api/ship/ships/me', () => {
        shipCalls += 1
        const balance = shipCalls === 1 ? 250 : shipCalls === 2 ? 255 : 260
        return HttpResponse.json(createHealthyShip({ materials_balance: balance }))
      }),
    )
    await renderDailies()
    enableProbeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    await flushProbes()
    expect(screen.getByText('Ship materials: 250')).toBeInTheDocument()

    // An unrelated +5 movement (not the +10 award) keeps the reconciliation
    // probing; it must not stop as ready nor expire as delayed.
    scheduler.advance(1_000)
    await advanceClock(1_000)
    await flushProbes()
    expect(screen.getByText('Ship materials: 255')).toBeInTheDocument()
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
    expect(screen.getByText(/Updating…/)).toBeInTheDocument()

    // The full award (baseline + 10) lands; probing stops as ready.
    scheduler.advance(1_000)
    await advanceClock(1_000)
    await flushProbes()
    expect(screen.getByText('Ship materials: 260')).toBeInTheDocument()
    expect(screen.queryByText(/Updating…/)).not.toBeInTheDocument()
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
  })

  it('keeps stale rows visible and labelled when the refresh fails', async () => {
    const user = userEvent.setup()
    await renderDailies()

    server.server.use(
      http.get('/api/daily/dailies', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'List exploded.' } },
          { status: 500 },
        ),
      ),
    )
    // Completing invalidates the list; the refetch fails while data is shown.
    await user.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))

    expect(
      await screen.findByText('Showing the last confirmed Dailies — refresh failed.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Calibrate sensors' })).toBeInTheDocument()

    server.server.resetHandlers()
    await user.click(screen.getByRole('button', { name: 'Retry refresh' }))
    await vi.waitFor(() => {
      expect(screen.queryByText('Showing the last confirmed Dailies — refresh failed.')).toBeNull()
    })
    expect(screen.getByText('Completed · +10 materials')).toBeInTheDocument()
  })

  it('shows a preparing state for DAILY_PLAYER_NOT_READY with a working Retry', async () => {
    const user = userEvent.setup()
    server.reset('provisioning')
    await seedAuthenticatedSession()
    renderAppAt('/dailies')
    expect(await screen.findByText('Preparing your Dailies')).toBeInTheDocument()
    expect(screen.getByText('Preparing…')).toBeInTheDocument()

    scheduler.advance(5_000)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'No Dailies' })).toBeInTheDocument()
  })

  it('shows an unavailable state on initial failure and recovers on Retry', async () => {
    const user = userEvent.setup()
    server.server.use(
      http.get('/api/daily/dailies', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'List exploded.' } },
          { status: 500 },
        ),
      ),
    )
    renderAppAt('/dailies')
    expect(
      await screen.findByRole('heading', { name: 'Dailies are unavailable' }),
    ).toBeInTheDocument()

    server.server.resetHandlers()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Calibrate sensors' })).toBeInTheDocument()
  })
})

describe('/dailies delete', () => {
  it('names the Daily, explains history remains, and removes the row on confirm', async () => {
    const user = userEvent.setup()
    await renderDailies()

    await user.click(screen.getByRole('button', { name: 'Delete Stretch the solar sails' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete "Stretch the solar sails"?',
    })
    expect(
      within(dialog).getByText(
        /recurrence is removed for future days. Past outcomes stay in Daily history/i,
      ),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Delete Daily' }))
    await vi.waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Stretch the solar sails' })).toBeNull()
    })
    expect(screen.getByRole('heading', { name: 'Calibrate sensors' })).toBeInTheDocument()
  })

  it('preserves the row and surfaces the failure in the dialog', async () => {
    const user = userEvent.setup()
    await renderDailies()

    server.server.use(
      http.delete('/api/daily/dailies/:id', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Delete exploded.' } },
          { status: 500 },
        ),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Delete Stretch the solar sails' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete "Stretch the solar sails"?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Delete Daily' }))

    expect(await within(dialog).findByText('Delete exploded.')).toBeInTheDocument()
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Stretch the solar sails' })).toBeInTheDocument()
  })
})

describe('/dailies optimistic completion under filters', () => {
  it('removes the completed row from the Pending filter at once', async () => {
    const user = userEvent.setup()
    await renderDailies()
    await user.click(screen.getByRole('button', { name: 'Pending' }))
    expect(screen.getByRole('heading', { name: 'Calibrate sensors' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    await vi.waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Calibrate sensors' })).toBeNull()
    })
    expect(screen.getByRole('heading', { name: 'Stretch the solar sails' })).toBeInTheDocument()
  })

  it('restores the removed row in place on failure under the Pending filter', async () => {
    const user = userEvent.setup()
    // Gate the failure so the optimistic removal window is observable.
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.server.use(
      http.post('/api/daily/dailies/:id/complete', async () => {
        await gate
        return HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Completion exploded.' } },
          { status: 500 },
        )
      }),
    )
    await renderDailies()
    await user.click(screen.getByRole('button', { name: 'Pending' }))

    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    await vi.waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Calibrate sensors' })).toBeNull()
    })

    // Failure restores only the affected row; the sibling row is untouched.
    release()
    expect(await screen.findByRole('heading', { name: 'Calibrate sensors' })).toBeInTheDocument()
    expect(screen.getByText('Completion exploded.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete Calibrate sensors' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Stretch the solar sails' })).toBeInTheDocument()
  })
})

describe('/dailies Back/Forward reproducibility', () => {
  it('restores date and status search state across Back and Forward', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/dailies'] })
    render(<AppProviders router={router} />)
    await screen.findByRole('heading', { level: 1, name: 'Dailies' })
    await screen.findByRole('heading', { name: 'Calibrate sensors' })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Next day' }))
    expect(router.state.location.search).toBe('?date=2026-01-16')
    expect(await screen.findByRole('heading', { name: 'No Dailies' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(router.state.location.search).toBe('')
    expect(await screen.findByRole('heading', { name: 'Calibrate sensors' })).toBeInTheDocument()

    // Back restores the previously selected day; Forward restores today.
    await router.navigate(-1)
    expect(router.state.location.search).toBe('?date=2026-01-16')
    expect(await screen.findByRole('heading', { name: 'No Dailies' })).toBeInTheDocument()
    await router.navigate(1)
    expect(router.state.location.search).toBe('')
    expect(await screen.findByRole('heading', { name: 'Calibrate sensors' })).toBeInTheDocument()

    // The status filter is URL search state and restores across Back/Forward.
    await user.click(screen.getByRole('button', { name: 'Pending' }))
    expect(router.state.location.search).toBe('?status=PENDING')
    expect(
      screen.queryByRole('heading', { name: 'Hydrate the coolant loop' }),
    ).not.toBeInTheDocument()
    await router.navigate(-1)
    expect(router.state.location.search).toBe('')
    await router.navigate(1)
    expect(router.state.location.search).toBe('?status=PENDING')
    expect(await screen.findByRole('heading', { name: 'Calibrate sensors' })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Hydrate the coolant loop' }),
    ).not.toBeInTheDocument()
  })
})
