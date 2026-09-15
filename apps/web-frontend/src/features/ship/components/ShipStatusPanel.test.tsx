import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ApiTransport } from '@/api/transport'
import { createQueryClient } from '@/app/queryClient'
import {
  createDamagedShip,
  createExpeditionQuote,
  createMockTestServer,
  FIXED_MOCK_EPOCH_MS,
  ManualMockScheduler,
  type MockScenarioName,
  onUnhandledMockRequest,
} from '@/mocks'
import { TransportProvider } from '@/shared/api/TransportContext'
import { advanceFake, enableFakeTimers, settleForeground, waitForUi } from '@/test/fakeTimers'

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
async function mountPanel(
  scenario: MockScenarioName = 'established-player',
  queryClient: QueryClient = createQueryClient(),
): Promise<QueryClient> {
  server.server.resetHandlers()
  server.reset(scenario)
  const transport = await createPanelTransport()
  mountPanelTree(queryClient, transport)
  await screen.findByRole('heading', { level: 2, name: 'Ship status' })
  return queryClient
}

function mountPanelTree(
  queryClient: QueryClient,
  transport: ApiTransport,
  extra?: React.ReactNode,
) {
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <TransportProvider transport={transport}>
          <ShipStatusPanel />
          {extra}
        </TransportProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
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

/** An active expedition query observer so invalidation is observable. */
function ExpeditionObserver({ onObserved }: { onObserved: () => void }) {
  useQuery({
    queryKey: ['expeditions', 'current'],
    queryFn: () => {
      onObserved()
      return null
    },
  })
  return null
}

describe('ShipStatusPanel composite', () => {
  it('renders the Ship status without route chrome', async () => {
    await mountPanel('established-player')

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
    const queryClient = await mountPanel('established-player')
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

  it('shows Updating… after a repair and settles when the next probe succeeds', async () => {
    enableFakeTimers(FIXED_MOCK_EPOCH_MS)
    server.server.resetHandlers()
    server.reset('damaged-ship')
    // The Expedition service has not caught up yet: its quote still shows the
    // pre-repair balance, so the immediate probe fails and Updating… persists.
    server.server.use(
      http.get('/api/expedition/expeditions/quote', () =>
        HttpResponse.json(createExpeditionQuote(), { status: 200 }),
      ),
    )
    const transport = await createPanelTransport()
    mountPanelTree(createQueryClient(), transport)
    await waitForUi(() => screen.queryByRole('button', { name: 'Repair Ship' }) !== null)

    fireEvent.click(screen.getByRole('button', { name: 'Repair Ship' }))

    await waitForUi(() => screen.queryByText('100 / 100') !== null)
    expect(screen.getByText('62')).toBeInTheDocument()
    expect(screen.getByText('Updating…')).toBeInTheDocument()

    // The ~1 s probe sees the new balance once the service has caught up.
    server.server.resetHandlers()
    await advanceFake(1_000)
    await waitForUi(() => screen.queryByText('Updating…') === null)
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
  })

  it('shows Updating…, then Update delayed with a local Retry that re-probes', async () => {
    enableFakeTimers(FIXED_MOCK_EPOCH_MS)
    server.server.resetHandlers()
    server.reset('damaged-ship')
    // The Expedition service never catches up: its quote stays on the
    // pre-repair balance, so every probe fails.
    server.server.use(
      http.get('/api/expedition/expeditions/quote', () =>
        HttpResponse.json(createExpeditionQuote(), { status: 200 }),
      ),
    )
    const transport = await createPanelTransport()
    mountPanelTree(createQueryClient(), transport)
    await waitForUi(() => screen.queryByRole('button', { name: 'Repair Ship' }) !== null)

    fireEvent.click(screen.getByRole('button', { name: 'Repair Ship' }))
    await waitForUi(() => screen.queryByText('Updating…') !== null)

    // Probes run at ~0, 1, 2, 4, and 8 s; all fail because the quote is stale.
    // The final advance also covers the fake-timer delivery of the ~8 s probe.
    await advanceFake(1_000)
    await advanceFake(1_000)
    await advanceFake(2_000)
    await advanceFake(4_000)
    await advanceFake(1_000)
    await settleForeground()

    expect(screen.getByText('Update delayed')).toBeInTheDocument()

    server.server.resetHandlers()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    // Retry restarts the schedule; the immediate probe now succeeds.
    await waitForUi(
      () =>
        screen.queryByText('Updating…') === null && screen.queryByText('Update delayed') === null,
    )
  })

  it('pauses reconciliation while the tab is hidden', async () => {
    enableFakeTimers(FIXED_MOCK_EPOCH_MS)
    server.server.resetHandlers()
    server.reset('damaged-ship')
    server.server.use(
      http.get('/api/expedition/expeditions/quote', () =>
        HttpResponse.json(createExpeditionQuote(), { status: 200 }),
      ),
    )
    const transport = await createPanelTransport()
    mountPanelTree(createQueryClient(), transport)
    await waitForUi(() => screen.queryByRole('button', { name: 'Repair Ship' }) !== null)

    fireEvent.click(screen.getByRole('button', { name: 'Repair Ship' }))
    await waitForUi(() => screen.queryByText('100 / 100') !== null)
    expect(screen.getByText('Updating…')).toBeInTheDocument()

    installVisibility(false)
    await advanceFake(10_000)
    // No probe ran while hidden, so the reconciliation is still updating.
    expect(screen.getByText('Updating…')).toBeInTheDocument()

    installVisibility(true)
    server.server.resetHandlers()
    await advanceFake(1_000)
    await waitForUi(() => screen.queryByText('Updating…') === null)
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
  })

  it('invalidates Expedition queries after a successful repair', async () => {
    const user = userEvent.setup()
    server.server.resetHandlers()
    server.reset('damaged-ship')
    const queryClient = createQueryClient()
    const transport = await createPanelTransport()
    let observations = 0
    mountPanelTree(
      queryClient,
      transport,
      <ExpeditionObserver
        onObserved={() => {
          observations += 1
        }}
      />,
    )
    await screen.findByRole('button', { name: 'Repair Ship' })
    expect(observations).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Repair Ship' }))
    await screen.findByText('100 / 100')

    await vi.waitFor(() => {
      expect(observations).toBeGreaterThanOrEqual(2)
    })
  })

  it('recomputes the relative updated-at label on an interval while visible', async () => {
    enableFakeTimers(FIXED_MOCK_EPOCH_MS)
    server.server.resetHandlers()
    server.reset('established-player')
    server.server.use(
      http.get('/api/ship/ships/me', () =>
        HttpResponse.json(
          createDamagedShip({
            updated_at: new Date(FIXED_MOCK_EPOCH_MS - 120_000).toISOString(),
          }),
          { status: 200 },
        ),
      ),
    )
    const transport = await createPanelTransport()
    mountPanelTree(createQueryClient(), transport)
    await waitForUi(() => screen.queryByRole('button', { name: 'Repair Ship' }) !== null)

    expect(screen.getByText(/Updated 2 minutes ago/)).toBeInTheDocument()

    // Two interval ticks (60 s): the relative label crosses into 3 minutes.
    // The extra advance covers fake-timer tick delivery (~1 ms late).
    await advanceFake(30_000)
    await advanceFake(30_000)
    await advanceFake(1_000)

    expect(screen.getByText(/Updated 3 minutes ago/)).toBeInTheDocument()
  })

  it('focuses the failure outcome and lets Retry repair again', async () => {
    const user = userEvent.setup()
    await mountPanel('damaged-ship')
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
