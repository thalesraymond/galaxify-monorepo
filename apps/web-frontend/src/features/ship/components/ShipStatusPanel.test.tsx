import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ApiTransport } from '@/api/transport'
import { createQueryClient } from '@/app/queryClient'
import {
  createMockTestServer,
  FIXED_MOCK_EPOCH_MS,
  ManualMockScheduler,
  type MockScenarioName,
  onUnhandledMockRequest,
} from '@/mocks'
import { TransportProvider } from '@/shared/api/TransportContext'

import { shipQueryKey } from '../api/shipApi'
import { ShipStatusPanel } from './ShipStatusPanel'

const scheduler = new ManualMockScheduler(FIXED_MOCK_EPOCH_MS)
const server = createMockTestServer({ scenario: 'established-player', scheduler })

beforeAll(() => {
  server.server.listen({ onUnhandledRequest: onUnhandledMockRequest })
})

afterEach(() => {
  server.server.resetHandlers()
  server.reset()
  vi.useRealTimers()
  restoreVisibility()
})

afterAll(() => {
  server.stop()
})

async function createPanelTransport(): Promise<ApiTransport> {
  const response = await fetch('/api/user/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'captain@galaxify.test', password: 'password123' }),
  })
  const body = (await response.json()) as { access_token: string }
  return new ApiTransport({ getAccessToken: () => body.access_token })
}

/** Renders the composite without route chrome; returns the query client. */
async function renderPanel(
  scenario: MockScenarioName = 'established-player',
  queryClient: QueryClient = createQueryClient(),
): Promise<{ transport: ApiTransport }> {
  server.server.resetHandlers()
  server.reset(scenario)
  const transport = await createPanelTransport()
  renderPanelTree(queryClient, transport)
  await screen.findByRole('heading', { level: 2, name: 'Ship status' })
  return { transport }
}

function renderPanelTree(queryClient: QueryClient, transport: ApiTransport): void {
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <TransportProvider transport={transport}>
          <ShipStatusPanel />
        </TransportProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

/** Settles async work under fake timers (RTL cannot auto-advance these). */
async function settleForeground(): Promise<void> {
  await advanceFake(0)
}

async function advanceFake(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function installVisibility(visible: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (visible ? 'visible' : 'hidden'),
  })
}

function restoreVisibility(): void {
  delete (document as unknown as Record<string, unknown>).visibilityState
}

describe('ShipStatusPanel composite', () => {
  it('renders the Ship status without route chrome', async () => {
    await renderPanel('established-player')

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Hull health' })).toHaveAttribute(
      'aria-valuenow',
      '96',
    )
    expect(screen.getByText('250')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repair Ship' })).toBeEnabled()
  })

  it('keeps the last confirmed Ship and labels it stale when a refresh fails', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    await renderPanel('established-player', queryClient)

    expect(screen.getByText('96 / 100')).toBeInTheDocument()

    server.server.use(
      http.get('/api/ship/ships/me', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Ship service failed.' } },
          { status: 500 },
        ),
      ),
    )
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: shipQueryKey })
    })

    expect(await screen.findByText('Stale')).toBeInTheDocument()
    expect(screen.getByText('96 / 100')).toBeInTheDocument()

    server.server.resetHandlers()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('96 / 100')).toBeInTheDocument()
    expect(screen.queryByText('Stale')).not.toBeInTheDocument()
  })

  it('shows Updating… after a repair and settles when the probe succeeds', async () => {
    vi.useFakeTimers({
      now: FIXED_MOCK_EPOCH_MS,
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    server.server.resetHandlers()
    server.reset('damaged-ship')
    const transport = await createPanelTransport()
    renderPanelTree(createQueryClient(), transport)
    await waitForPanelFake()

    fireEvent.click(screen.getByRole('button', { name: 'Repair Ship' }))

    await waitForUiFake(() => screen.queryByText('100 / 100') !== null)
    expect(screen.getByText('62')).toBeInTheDocument()
    expect(screen.getByText('Updating…')).toBeInTheDocument()

    // First probe fires at ~1 s; the mock Expedition service sees the new
    // balance, so the reconciliation settles.
    await advanceFake(1_000)
    await waitForUiFake(() => screen.queryByText('Updating…') === null)
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
  })

  it('shows Updating…, then Update delayed with a local Retry that re-probes', async () => {
    vi.useFakeTimers({
      now: FIXED_MOCK_EPOCH_MS,
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    server.server.resetHandlers()
    server.reset('damaged-ship')
    // The Expedition service has not caught up: its quote still shows the
    // pre-repair balance, so every probe fails.
    server.server.use(
      http.get('/api/expedition/expeditions/quote', () =>
        HttpResponse.json(staleQuote(), { status: 200 }),
      ),
    )
    const transport = await createPanelTransport()
    renderPanelTree(createQueryClient(), transport)
    await waitForPanelFake()

    fireEvent.click(screen.getByRole('button', { name: 'Repair Ship' }))
    await waitForUiFake(() => screen.queryByText('Updating…') !== null)

    // Probes run at ~1, 2, 4, and 8 s; all fail because the quote is stale.
    await advanceFake(1_000)
    await advanceFake(2_000)
    await advanceFake(4_000)
    await advanceFake(8_000)
    await settleForeground()

    expect(screen.getByText('Update delayed')).toBeInTheDocument()

    server.server.resetHandlers()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.getByText('Updating…')).toBeInTheDocument()

    await advanceFake(1_000)
    await waitForUiFake(() => screen.queryByText('Updating…') === null)
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
  })

  it('pauses reconciliation while the tab is hidden', async () => {
    vi.useFakeTimers({
      now: FIXED_MOCK_EPOCH_MS,
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    server.server.resetHandlers()
    server.reset('damaged-ship')
    const transport = await createPanelTransport()
    renderPanelTree(createQueryClient(), transport)
    await waitForPanelFake()

    fireEvent.click(screen.getByRole('button', { name: 'Repair Ship' }))
    await waitForUiFake(() => screen.queryByText('100 / 100') !== null)
    expect(screen.getByText('Updating…')).toBeInTheDocument()

    installVisibility(false)
    await advanceFake(10_000)
    // No probe ran while hidden, so the reconciliation is still updating.
    expect(screen.getByText('Updating…')).toBeInTheDocument()

    installVisibility(true)
    await advanceFake(1_000)
    await waitForUiFake(() => screen.queryByText('Updating…') === null)
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
  })

  it('focuses the failure outcome and lets Retry repair again', async () => {
    const user = userEvent.setup()
    await renderPanel('damaged-ship')
    server.server.use(
      http.post('/api/ship/ships/repair', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Ship service failed.' } },
          { status: 500 },
        ),
      ),
    )

    await user.click(await screen.findByRole('button', { name: 'Repair Ship' }))

    expect(
      await screen.findByText('We could not reach the Ship service. Try again.'),
    ).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry).toHaveFocus()

    server.server.resetHandlers()
    await user.click(retry)

    expect(await screen.findByText('The Ship was repaired.')).toBeInTheDocument()
    expect(screen.getByText('100 / 100')).toBeInTheDocument()
  })
})

function staleQuote() {
  return {
    materials_invested: 0,
    normalized_investment: 0,
    projected_balance: 120,
    success_chance: 0,
    eligible: false,
    blocker: 'EXPEDITION_INSUFFICIENT_MATERIALS',
    cooldown_until: null,
    estimated_resolve_at: '2026-01-15T10:00:00Z',
    estimated_resolve_window_seconds: 3600,
  }
}

async function waitForPanelFake(): Promise<void> {
  await waitForUiFake(() => screen.queryByRole('button', { name: 'Repair Ship' }) !== null)
}

async function waitForUiFake(ready: () => boolean, attempts = 60): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (ready()) {
      return
    }
    await settleForeground()
  }
  throw new Error('Timed out waiting for the UI under fake timers.')
}
