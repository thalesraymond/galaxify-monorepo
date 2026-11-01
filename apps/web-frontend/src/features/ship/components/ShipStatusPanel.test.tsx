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
import {
  clearDownstreamObservations,
  downstreamReconciliation,
  registerBalanceGateKey,
  registerDownstreamObservation,
} from '@/shared/reconciliation'
import { advanceFake, enableFakeTimers, settleForeground, waitForUi } from '@/test/fakeTimers'

import { shipQueryKey } from '../api/shipApi'
import { ShipStatusPanel } from './ShipStatusPanel'

const scheduler = new ManualMockScheduler(FIXED_MOCK_EPOCH_MS)
const server = createMockTestServer({ scenario: 'established-player', scheduler })

beforeAll(() => {
  server.server.listen({ onUnhandledRequest: onUnhandledMockRequest })
})

afterEach(() => {
  act(() => {
    clearDownstreamObservations()
  })
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
  return render(
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
  it('drops a repair response received after the session clears', async () => {
    const user = userEvent.setup()
    server.reset('damaged-ship')
    const queryClient = createQueryClient()
    const transport = await createPanelTransport()
    const view = mountPanelTree(queryClient, transport)
    await screen.findByRole('heading', { level: 2, name: 'Ship status' })
    let release: () => void = () => {}
    let received: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      received = resolve
    })
    server.server.use(
      http.post('/api/ship/ships/repair', async () => {
        received()
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return HttpResponse.json(createDamagedShip({ hull_health: 100 }))
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Repair Ship' }))
    await started
    act(() => {
      view.unmount()
      clearDownstreamObservations()
      queryClient.clear()
    })
    await act(async () => {
      release()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(queryClient.getQueryData(shipQueryKey)).toBeUndefined()
    expect(downstreamReconciliation.getPhase('ship:repair:readiness')).toBe('idle')
    expect(screen.queryByText('The Ship was repaired.')).not.toBeInTheDocument()
  })
  it('blocks repair while a balance observation is updating', async () => {
    await mountPanel()
    act(() => {
      registerBalanceGateKey('daily:test:award')
      registerDownstreamObservation({
        key: 'daily:test:award',
        read: () => new Promise(() => {}),
        isSatisfied: () => false,
        publish: () => {},
      })
    })
    const repair = screen.getByRole('button', { name: 'Repair Ship' })
    expect(repair).toBeDisabled()
    expect(repair).toHaveAccessibleDescription(/balance/i)
  })

  it('keeps concise guidance beside Repair and discloses detailed mechanics on demand', async () => {
    const user = userEvent.setup()
    await mountPanel('damaged-ship')

    expect(screen.getByRole('button', { name: 'Repair Ship' })).toHaveAccessibleDescription(
      'Spend materials; restoration varies.',
    )
    const summary = screen.getByText('How repair works')
    expect(screen.getByText(/Repairing spends materials/)).not.toBeVisible()
    await user.click(summary)
    expect(screen.getByText(/Repairing spends materials/)).toBeVisible()
    await user.click(summary)
    expect(screen.getByText(/Repairing spends materials/)).not.toBeVisible()
  })

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

  it('shows Updating… after a repair and settles when the next read succeeds', async () => {
    enableFakeTimers(FIXED_MOCK_EPOCH_MS)
    server.server.resetHandlers()
    server.reset('damaged-ship')
    // The Expedition service has not caught up yet: its quote still shows the
    // pre-repair balance, so the immediate read fails and Updating… persists.
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

    // The ~1 s read sees the new balance once the service has caught up.
    server.server.resetHandlers()
    await advanceFake(1_000)
    await waitForUi(() => screen.queryByText('Updating…') === null)
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
  })

  it('observes current balances after a concurrent award and publishes the fresh quote', async () => {
    enableFakeTimers(FIXED_MOCK_EPOCH_MS)
    server.server.resetHandlers()
    server.reset('damaged-ship')
    const transport = await createPanelTransport()
    const queryClient = createQueryClient()
    mountPanelTree(queryClient, transport)
    await waitForUi(() => screen.queryByRole('button', { name: 'Repair Ship' }) !== null)
    server.server.use(
      http.get('/api/ship/ships/me', () =>
        HttpResponse.json(createDamagedShip({ hull_health: 100, materials_balance: 80 })),
      ),
      http.get('/api/expedition/expeditions/quote', () =>
        HttpResponse.json(createExpeditionQuote({ materials_invested: 1, projected_balance: 79 })),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Repair Ship' }))
    await waitForUi(() => screen.queryByText('The Ship was repaired.') !== null)
    await waitForUi(() => screen.queryByText('80') !== null)
    await waitForUi(() => screen.queryByText('Updating…') === null)
    expect(queryClient.getQueryData(['expeditions', 'quote', 1])).toMatchObject({
      materials_invested: 1,
      projected_balance: 79,
    })
  })

  it('publishes a fresh quote even when the Ship refresh fails without claiming agreement', async () => {
    enableFakeTimers(FIXED_MOCK_EPOCH_MS)
    server.reset('damaged-ship')
    const transport = await createPanelTransport()
    const queryClient = createQueryClient()
    mountPanelTree(queryClient, transport)
    await waitForUi(() => screen.queryByRole('button', { name: 'Repair Ship' }) !== null)
    server.server.use(
      http.get('/api/ship/ships/me', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/expedition/expeditions/quote', () =>
        HttpResponse.json(createExpeditionQuote({ materials_invested: 1, projected_balance: 61 })),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Repair Ship' }))
    await waitForUi(() => screen.queryByText('Updating…') !== null)
    await settleForeground()
    expect(queryClient.getQueryData(['expeditions', 'quote', 1])).toMatchObject({
      projected_balance: 61,
    })
    expect(screen.getByText('Updating…')).toBeInTheDocument()
  })

  it.each([
    { blocker: null, balance: 40 },
    { blocker: 'EXPEDITION_COOLDOWN', balance: 62 },
    { blocker: 'EXPEDITION_ALREADY_ACTIVE', balance: 62 },
    { blocker: 'EXPEDITION_INSUFFICIENT_MATERIALS', balance: 0 },
  ])('accepts current balance $balance with blocker $blocker', async ({ blocker, balance }) => {
    enableFakeTimers(FIXED_MOCK_EPOCH_MS)
    server.reset('damaged-ship')
    const transport = await createPanelTransport()
    const queryClient = createQueryClient()
    mountPanelTree(queryClient, transport)
    await waitForUi(() => screen.queryByRole('button', { name: 'Repair Ship' }) !== null)
    server.server.use(
      http.get('/api/ship/ships/me', () =>
        HttpResponse.json(createDamagedShip({ hull_health: 100, materials_balance: balance })),
      ),
      http.get('/api/expedition/expeditions/quote', () =>
        HttpResponse.json(
          createExpeditionQuote({
            materials_invested: 1,
            projected_balance: balance - 1,
            eligible: blocker === null,
            blocker,
          }),
        ),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Repair Ship' }))
    await waitForUi(() => screen.queryByText('The Ship was repaired.') !== null)
    await waitForUi(() => queryClient.getQueryData(['expeditions', 'quote', 1]) !== undefined)
    await waitForUi(() => screen.queryByText('Updating…') === null)
    expect(queryClient.getQueryData(['expeditions', 'quote', 1])).toMatchObject({
      blocker,
      projected_balance: balance - 1,
    })
  })

  it('does not combine a retained quote with a later Ship read when quote refresh fails', async () => {
    enableFakeTimers(FIXED_MOCK_EPOCH_MS)
    server.reset('damaged-ship')
    const transport = await createPanelTransport()
    const queryClient = createQueryClient()
    mountPanelTree(queryClient, transport)
    await waitForUi(() => screen.queryByRole('button', { name: 'Repair Ship' }) !== null)
    server.server.use(
      http.get('/api/ship/ships/me', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/expedition/expeditions/quote', () =>
        HttpResponse.json(createExpeditionQuote({ materials_invested: 1, projected_balance: 61 })),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Repair Ship' }))
    await waitForUi(() => queryClient.getQueryData(['expeditions', 'quote', 1]) !== undefined)
    server.server.use(
      http.get('/api/ship/ships/me', () =>
        HttpResponse.json(createDamagedShip({ hull_health: 100, materials_balance: 62 })),
      ),
      http.get('/api/expedition/expeditions/quote', () => new HttpResponse(null, { status: 500 })),
    )
    await advanceFake(1_000)
    expect(screen.getByText('Updating…')).toBeInTheDocument()
    expect(queryClient.getQueryData(['expeditions', 'quote', 1])).toMatchObject({
      projected_balance: 61,
    })
    server.server.resetHandlers()
    await advanceFake(1_000)
    await waitForUi(() => screen.queryByText('Updating…') === null)
  })

  it('retains the pending observation through navigation and resumes it on return', async () => {
    enableFakeTimers(FIXED_MOCK_EPOCH_MS)
    server.reset('damaged-ship')
    const transport = await createPanelTransport()
    const queryClient = createQueryClient()
    const view = mountPanelTree(queryClient, transport)
    await waitForUi(() => screen.queryByRole('button', { name: 'Repair Ship' }) !== null)
    let reads = 0
    server.server.use(
      http.get('/api/expedition/expeditions/quote', () => {
        reads += 1
        return HttpResponse.json(createExpeditionQuote())
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Repair Ship' }))
    await waitForUi(() => reads > 0)
    view.unmount()
    const beforeNavigation = reads
    await advanceFake(10_000)
    expect(reads).toBe(beforeNavigation)
    server.server.resetHandlers()
    mountPanelTree(queryClient, transport)
    await waitForUi(() => screen.queryByText('Updating…') !== null)
    await advanceFake(1_000)
    await waitForUi(() => screen.queryByText('Updating…') === null)
  })

  it('discards a quote that completes after the session is cleared', async () => {
    enableFakeTimers(FIXED_MOCK_EPOCH_MS)
    server.reset('damaged-ship')
    const transport = await createPanelTransport()
    const queryClient = createQueryClient()
    mountPanelTree(queryClient, transport)
    await waitForUi(() => screen.queryByRole('button', { name: 'Repair Ship' }) !== null)
    let release!: () => void
    let started = false
    server.server.use(
      http.get('/api/expedition/expeditions/quote', async () => {
        started = true
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return HttpResponse.json(createExpeditionQuote({ projected_balance: 61 }))
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Repair Ship' }))
    await waitForUi(() => started)
    act(() => {
      clearDownstreamObservations()
    })
    await act(async () => {
      release()
      await Promise.resolve()
    })
    await settleForeground()
    expect(queryClient.getQueryData(['expeditions', 'quote', 1])).toBeUndefined()
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
  })

  it.each(['updating', 'delayed'] as const)(
    'a second repair supersedes a %s observation with a fresh budget',
    async (phase) => {
      enableFakeTimers(FIXED_MOCK_EPOCH_MS)
      server.reset('damaged-ship')
      const transport = await createPanelTransport()
      const queryClient = createQueryClient()
      mountPanelTree(queryClient, transport)
      await waitForUi(() => screen.queryByRole('button', { name: 'Repair Ship' }) !== null)
      let repairs = 0
      let reads = 0
      let release!: () => void
      server.server.use(
        http.post('/api/ship/ships/repair', () => {
          repairs += 1
          return HttpResponse.json(createDamagedShip({ hull_health: 90, materials_balance: 62 }))
        }),
        http.get('/api/ship/ships/me', () =>
          HttpResponse.json(createDamagedShip({ hull_health: 90, materials_balance: 62 })),
        ),
        http.get('/api/expedition/expeditions/quote', async () => {
          reads += 1
          if (phase === 'updating' && reads === 1) {
            await new Promise<void>((resolve) => {
              release = resolve
            })
            return HttpResponse.json(createExpeditionQuote({ projected_balance: 999 }))
          }
          return HttpResponse.json(createExpeditionQuote({ projected_balance: 119 }))
        }),
      )
      fireEvent.click(screen.getByRole('button', { name: 'Repair Ship' }))
      await waitForUi(() => reads > 0)
      if (phase === 'delayed') {
        for (const ms of [1_000, 1_000, 2_000, 4_000, 1_000]) await advanceFake(ms)
      }
      expect(screen.queryByText('Update delayed') !== null).toBe(phase === 'delayed')
      const beforeSecond = reads
      fireEvent.click(screen.getByRole('button', { name: 'Repair Ship' }))
      await waitForUi(() => repairs === 2 && reads > beforeSecond)
      expect(screen.getByText('Updating…')).toBeInTheDocument()
      if (phase === 'updating') {
        await act(async () => {
          release()
          await Promise.resolve()
        })
        await settleForeground()
      }
      expect(queryClient.getQueryData(['expeditions', 'quote', 1])).not.toMatchObject({
        projected_balance: 999,
      })
      server.server.use(
        http.get('/api/expedition/expeditions/quote', () =>
          HttpResponse.json(createExpeditionQuote({ projected_balance: 61 })),
        ),
      )
      await advanceFake(1_000)
      await waitForUi(() => screen.queryByText('Updating…') === null)
    },
  )

  it('shows Updating…, then Update delayed with a local Retry that re-reads', async () => {
    enableFakeTimers(FIXED_MOCK_EPOCH_MS)
    server.server.resetHandlers()
    server.reset('damaged-ship')
    // The Expedition service never catches up: its quote stays on the
    // pre-repair balance, so every read fails.
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

    // Reads run at ~0, 1, 2, 4, and 8 s; all fail because the quote is stale.
    // The final advance also covers the fake-timer delivery of the ~8 s read.
    await advanceFake(1_000)
    await advanceFake(1_000)
    await advanceFake(2_000)
    await advanceFake(4_000)
    await advanceFake(1_000)
    await settleForeground()

    expect(screen.getByText('Update delayed')).toBeInTheDocument()

    server.server.resetHandlers()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    // Retry restarts the schedule; the immediate read now succeeds.
    await waitForUi(
      () =>
        screen.queryByText('Updating…') === null && screen.queryByText('Update delayed') === null,
    )
  })

  it('pauses reconciliation while the tab is hidden', async () => {
    enableFakeTimers(FIXED_MOCK_EPOCH_MS)
    server.server.resetHandlers()
    server.reset('damaged-ship')
    let reads = 0
    server.server.use(
      http.get('/api/expedition/expeditions/quote', () => {
        reads += 1
        return HttpResponse.json(createExpeditionQuote(), { status: 200 })
      }),
    )
    const transport = await createPanelTransport()
    mountPanelTree(createQueryClient(), transport)
    await waitForUi(() => screen.queryByRole('button', { name: 'Repair Ship' }) !== null)

    fireEvent.click(screen.getByRole('button', { name: 'Repair Ship' }))
    await waitForUi(() => screen.queryByText('100 / 100') !== null)
    expect(screen.getByText('Updating…')).toBeInTheDocument()

    installVisibility(false)
    const beforeHidden = reads
    await advanceFake(10_000)
    // No read ran while hidden, so the reconciliation is still updating.
    expect(reads).toBe(beforeHidden)
    expect(screen.getByText('Updating…')).toBeInTheDocument()

    installVisibility(true)
    server.server.use(
      http.get('/api/expedition/expeditions/quote', () => {
        reads += 1
        return HttpResponse.json(
          createExpeditionQuote({ materials_invested: 1, projected_balance: 61 }),
        )
      }),
    )
    await advanceFake(1_300)
    await waitForUi(() => screen.queryByText('Updating…') === null)
    expect(reads).toBeGreaterThan(beforeHidden)
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

  it('does not allow a repair outcome retry while a Daily balance is updating', async () => {
    const user = userEvent.setup()
    await mountPanel('damaged-ship')
    server.server.use(
      http.post('/api/ship/ships/repair', () => new HttpResponse(null, { status: 500 })),
    )
    await user.click(screen.getByRole('button', { name: 'Repair Ship' }))
    await screen.findByText('We could not reach the Ship service. Try again.')
    act(() => {
      registerBalanceGateKey('daily:retry:award')
      registerDownstreamObservation({
        key: 'daily:retry:award',
        read: () => new Promise(() => {}),
        isSatisfied: () => false,
        publish: () => {},
      })
    })
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
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
    expect(screen.getByRole('button', { name: 'Repair Ship' })).toHaveAccessibleDescription(
      expect.stringContaining('We could not reach the Ship service. Try again.'),
    )

    server.server.resetHandlers()
    await user.click(retry)

    expect(await screen.findByText('The Ship was repaired.')).toBeInTheDocument()
    expect(screen.getByText('100 / 100')).toBeInTheDocument()
  })
})
