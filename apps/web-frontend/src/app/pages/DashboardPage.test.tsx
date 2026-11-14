process.env.TZ = 'UTC'

import { fireEvent, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { SESSION_REFRESH_STORAGE_KEY } from '@/features/auth'
import {
  createMockTestServer,
  createResolvedExpedition,
  FIXED_DAILY_IDS,
  FIXED_EXPEDITION_IDS,
  FIXED_MOCK_EPOCH_MS,
  ManualMockScheduler,
  type MockScenarioName,
  onUnhandledMockRequest,
} from '@/mocks'
import { renderAppAt } from '@/test/renderApp'
import { advanceFake, enableFakeTimers, waitForUi } from '@/test/fakeTimers'

const scheduler = new ManualMockScheduler(FIXED_MOCK_EPOCH_MS)
const server = createMockTestServer({ scenario: 'established-player', scheduler })

beforeAll(() => {
  server.server.listen({ onUnhandledRequest: onUnhandledMockRequest })
})

beforeEach(() => {
  vi.setSystemTime(new Date(FIXED_MOCK_EPOCH_MS))
})

afterEach(() => {
  server.server.resetHandlers()
  server.reset()
  vi.useRealTimers()
  window.localStorage.clear()
})

afterAll(() => {
  server.stop()
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

async function renderDashboard(
  scenario: MockScenarioName = 'established-player',
  setupHandlers?: () => void,
): Promise<void> {
  server.server.resetHandlers()
  server.reset(scenario)
  if (setupHandlers !== undefined) {
    setupHandlers()
  }
  window.localStorage.clear()
  vi.setSystemTime(new Date(FIXED_MOCK_EPOCH_MS))
  await seedAuthenticatedSession()
  renderAppAt('/dashboard')
  expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
}

describe('Dashboard page', () => {
  it('refreshes the adjacent Ship panel when a later Daily reconciliation read observes its reward', async () => {
    await renderDashboard()
    expect(await screen.findByText('250')).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Complete Calibrate sensors' }),
    ).toBeInTheDocument()
    enableFakeTimers(FIXED_MOCK_EPOCH_MS)

    fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
    await waitForUi(() => screen.queryByText('Ship materials: 250') !== null)
    expect(
      within(screen.getByRole('region', { name: 'Materials' })).getByText('250'),
    ).toBeInTheDocument()

    // The initial observation precedes event propagation. A later scheduled
    // observation must update both the row and the shared Ship query.
    scheduler.advance(1_000)
    await advanceFake(1_000)
    await waitForUi(() => screen.queryByText('Ship materials: 250') !== null)
    scheduler.advance(1_000)
    await advanceFake(1_000)
    await waitForUi(() => screen.queryByText('Ship materials: 260') !== null)
    // Deliver QueryClient's batched observer notification on the next tick.
    await advanceFake(1)
    await waitForUi(
      () => within(screen.getByRole('region', { name: 'Materials' })).queryByText('260') !== null,
    )

    expect(
      within(screen.getByRole('region', { name: 'Materials' })).getByText('260'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
  })

  it('renders the page heading and all three panels for an established player', async () => {
    await renderDashboard()

    // Dailies panel
    const dailies = await screen.findByRole('region', { name: "Today's Dailies" })
    expect(
      await screen.findByRole('heading', { level: 2, name: "Today's Dailies" }),
    ).toBeInTheDocument()
    expect(within(dailies).getByText('1/3 done')).toBeInTheDocument()
    expect(within(dailies).getByRole('link', { name: 'Manage Dailies' })).toHaveAttribute(
      'href',
      '/dailies',
    )
    // Pending Dailies are shown
    expect(await screen.findByRole('heading', { level: 3, name: 'Pending' })).toBeInTheDocument()
    expect(screen.getByText('Calibrate sensors')).toBeInTheDocument()

    // Ship panel
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Ship status' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Hull health' })).toBeInTheDocument()

    // Expedition panel
    expect(
      await screen.findByRole('heading', { level: 2, name: 'No Expedition in flight' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Plan Expedition' })).toHaveAttribute(
      'href',
      '/expeditions',
    )
  })

  it('keeps the Dashboard free of Daily date and filter management controls', async () => {
    await renderDashboard()

    const dailies = await screen.findByRole('region', { name: "Today's Dailies" })
    expect(within(dailies).queryByRole('combobox')).toBeNull()
    expect(within(dailies).queryByRole('spinbutton')).toBeNull()
    expect(within(dailies).queryByLabelText(/date/i)).toBeNull()
  })

  it('shows completed Dailies in a collapsible section', async () => {
    await renderDashboard()

    // The established-player scenario has one completed Daily (Hydrate the coolant loop).
    // The completed section is a <details> element that starts collapsed.
    const completedHeading = await screen.findByRole('heading', {
      name: /Completed \(1\)/u,
    })
    expect(completedHeading).toBeInTheDocument()
    // The heading is inside a <summary> which is inside a <details>.
    // The details element should not be open by default.
    // eslint-disable-next-line testing-library/no-node-access
    const completedSection = completedHeading.closest('details')
    expect(completedSection).not.toHaveAttribute('open')
  })

  it('restores a pending Daily row when completion is rejected', async () => {
    await renderDashboard('established-player', () => {
      server.server.use(
        http.post('/api/daily/dailies/:id/complete', () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'Database unavailable.' } },
            { status: 500 },
          ),
        ),
      )
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Complete Calibrate sensors' }))
    expect(await screen.findByText('Database unavailable.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Calibrate sensors' })).toBeInTheDocument()
    expect(screen.getByText('1/3 done')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete Calibrate sensors' })).toBeEnabled()
  })

  it('links each Daily Edit action to its edit route', async () => {
    await renderDashboard()

    const dailies = await screen.findByRole('region', { name: "Today's Dailies" })
    await screen.findByText('1/3 done')
    const editHrefs = within(dailies)
      .getAllByRole('link', { name: 'Edit' })
      .map((link) => link.getAttribute('href'))
      .sort()
    expect(editHrefs).toEqual(
      [
        `/dailies/${FIXED_DAILY_IDS.calibrate}/edit`,
        `/dailies/${FIXED_DAILY_IDS.hydrate}/edit`,
        `/dailies/${FIXED_DAILY_IDS.stretch}/edit`,
      ].sort(),
    )
  })

  it('removes a Daily after confirmation and keeps the remaining rows', async () => {
    await renderDashboard()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Calibrate sensors' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete "Calibrate sensors"?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Daily' }))

    expect(await screen.findByText('1/2 done')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('Calibrate sensors')).toBeNull()
    expect(screen.getByText('Stretch the solar sails')).toBeInTheDocument()
    expect(screen.getByText('Hydrate the coolant loop')).toBeInTheDocument()
  })

  it('shows an empty state with Create Daily when there are no Dailies', async () => {
    await renderDashboard('established-player', () => {
      server.server.use(
        http.get('/api/daily/dailies', () => HttpResponse.json([], { status: 200 })),
      )
    })

    expect(await screen.findByText('No Dailies for today')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create Daily' })).toHaveAttribute(
      'href',
      '/dailies/new',
    )
  })

  it('shows a provisioning state when Dailies are not ready', async () => {
    await renderDashboard('established-player', () => {
      server.server.use(
        http.get('/api/daily/dailies', () =>
          HttpResponse.json(
            { error: { code: 'DAILY_PLAYER_NOT_READY', message: 'Player state is provisioning.' } },
            { status: 425 },
          ),
        ),
      )
    })

    expect(await screen.findByText('Preparing your Dailies')).toBeInTheDocument()
  })

  it('shows an unavailable state when the Dailies service fails', async () => {
    await renderDashboard('established-player', () => {
      server.server.use(
        http.get('/api/daily/dailies', () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'Database unavailable.' } },
            { status: 500 },
          ),
        ),
      )
    })

    expect(await screen.findByText('Dailies are unavailable')).toBeInTheDocument()
  })

  it('shows the Expedition in flight when there is an active Expedition', async () => {
    await renderDashboard('active-expedition')

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Expedition in flight' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Investment/)).toBeInTheDocument()
    expect(screen.getByText(/Success chance/)).toBeInTheDocument()
  })

  it('links a resolved Expedition to its detail and keeps a stale notice on refresh failure', async () => {
    const resolvedId = FIXED_EXPEDITION_IDS.resolvedSuccess
    let currentCalls = 0
    await renderDashboard('resolved-expedition', () => {
      server.server.use(
        http.get('/api/expedition/expeditions/current', () => {
          currentCalls += 1
          return currentCalls === 1
            ? HttpResponse.json(createResolvedExpedition(resolvedId), { status: 200 })
            : HttpResponse.json(
                { error: { code: 'INTERNAL_ERROR', message: 'Refresh failed.' } },
                { status: 500 },
              )
        }),
      )
    })

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Expedition resolved' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View Expedition detail' })).toHaveAttribute(
      'href',
      `/expeditions/${resolvedId}`,
    )
    expect(screen.getByRole('link', { name: 'Plan Expedition' })).toHaveAttribute(
      'href',
      '/expeditions',
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Repair Ship' }))
    expect(
      await screen.findByText('Could not refresh. Showing the last confirmed state.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Expedition resolved' }),
    ).toBeInTheDocument()
  })

  it('shows a preparing state when the Expedition service is not ready', async () => {
    await renderDashboard('provisioning')

    // The provisioning scenario returns SHIP_NOT_FOUND for the Ship service
    expect(await screen.findByText('Preparing your Ship')).toBeInTheDocument()
  })

  it('shows an unavailable state when the Expedition service fails', async () => {
    await renderDashboard('established-player', () => {
      server.server.use(
        http.get('/api/expedition/expeditions/current', () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'Service unavailable.' } },
            { status: 500 },
          ),
        ),
      )
    })

    expect(await screen.findByText('Expeditions are unavailable')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Complete Calibrate sensors' }))
    expect(await screen.findByText('2/3 done')).toBeInTheDocument()
    expect(screen.getByText('Expeditions are unavailable')).toBeInTheDocument()
  })

  it('keeps Dailies completable when the Ship service is unavailable', async () => {
    await renderDashboard('established-player', () => {
      server.server.use(
        http.get('/api/ship/ships/me', () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'Ship service unavailable.' } },
            { status: 500 },
          ),
        ),
      )
    })

    expect(
      await screen.findByText('Ship status is unavailable', undefined, { timeout: 5000 }),
    ).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Complete Calibrate sensors' }))
    expect(await screen.findByText('2/3 done')).toBeInTheDocument()
    expect(screen.getByText('Ship status is unavailable')).toBeInTheDocument()
  })

  it('keeps Dailies completable while the Ship is still preparing', async () => {
    await renderDashboard('established-player', () => {
      server.server.use(
        http.get('/api/ship/ships/me', () =>
          HttpResponse.json(
            { error: { code: 'SHIP_NOT_FOUND', message: 'The Ship is still provisioning.' } },
            { status: 404 },
          ),
        ),
      )
    })

    expect(await screen.findByText('Preparing your Ship')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Complete Calibrate sensors' }))
    expect(await screen.findByText('2/3 done')).toBeInTheDocument()
    expect(screen.getByText('Preparing your Ship')).toBeInTheDocument()
  })

  it('shows a compact Ship summary and Inspect Ship leads to the detailed Ship route', async () => {
    await renderDashboard('damaged-ship')

    const ship = await screen.findByRole('region', { name: 'Ship status' })
    expect(within(ship).getByRole('link', { name: 'Inspect Ship' })).toHaveAttribute(
      'href',
      '/ship',
    )
    expect(within(ship).queryByText('How repair works')).toBeNull()
    expect(within(ship).getByRole('button', { name: 'Repair Ship' })).toBeEnabled()

    fireEvent.click(within(ship).getByRole('link', { name: 'Inspect Ship' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Ship' })).toBeInTheDocument()
    expect(await screen.findByRole('progressbar', { name: 'Hull health' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    )
    expect(screen.getByText('How repair works')).toBeInTheDocument()
  })

  it('shows the same confirmed Ship facts on the Ship route after a Dashboard repair', async () => {
    await renderDashboard()

    fireEvent.click(await screen.findByRole('button', { name: 'Repair Ship' }))
    expect(await screen.findByRole('progressbar', { name: 'Hull health' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
    expect(
      within(screen.getByRole('region', { name: 'Materials' })).getByText('246'),
    ).toBeInTheDocument()

    fireEvent.click(
      within(screen.getByRole('region', { name: 'Ship status' })).getByRole('link', {
        name: 'Inspect Ship',
      }),
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Ship' })).toBeInTheDocument()
    expect(await screen.findByRole('progressbar', { name: 'Hull health' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
    expect(
      within(screen.getByRole('region', { name: 'Materials' })).getByText('246'),
    ).toBeInTheDocument()
  })

  it('keeps the Ship panel functional alongside Dailies and Expedition', async () => {
    await renderDashboard('damaged-ship')

    // Ship shows damaged state
    const gauge = await screen.findByRole('progressbar', { name: 'Hull health' })
    expect(gauge).toHaveAttribute('aria-valuenow', '42')
    // Repair button is available
    expect(await screen.findByRole('button', { name: 'Repair Ship' })).toBeEnabled()
    // Dailies still render
    expect(screen.getByRole('heading', { level: 2, name: "Today's Dailies" })).toBeInTheDocument()
  })
})
