process.env.TZ = 'UTC'

import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { SESSION_REFRESH_STORAGE_KEY } from '@/features/auth'
import {
  createMockTestServer,
  FIXED_MOCK_EPOCH_MS,
  ManualMockScheduler,
  type MockScenarioName,
  onUnhandledMockRequest,
} from '@/mocks'
import { renderAppAt } from '@/test/renderApp'

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
  it('renders the page heading and all three panels for an established player', async () => {
    await renderDashboard()

    // Dailies panel
    expect(
      await screen.findByRole('heading', { level: 2, name: "Today's Dailies" }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/dailies')
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
    expect(screen.getByRole('link', { name: 'Launch an Expedition' })).toHaveAttribute(
      'href',
      '/expeditions',
    )
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
