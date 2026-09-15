import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { SESSION_REFRESH_STORAGE_KEY } from '@/features/auth'
import {
  createDamagedShip,
  createMockTestServer,
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

afterEach(() => {
  server.server.resetHandlers()
  server.reset()
  vi.useRealTimers()
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

/**
 * Renders at `/ship` with real timers. Handler overrides registered through
 * `setupHandlers` are applied after the server reset so they are not cleared.
 */
async function renderShip(
  scenario: MockScenarioName = 'established-player',
  setupHandlers?: () => void,
): Promise<void> {
  server.server.resetHandlers()
  server.reset(scenario)
  if (setupHandlers !== undefined) {
    setupHandlers()
  }
  window.localStorage.clear()
  await seedAuthenticatedSession()
  renderAppAt('/ship')
  expect(await screen.findByRole('heading', { level: 1, name: 'Ship' })).toBeInTheDocument()
}

/** Renders at `/ship` under fake timers, applying handler overrides first. */
async function renderShipFake(
  scenario: MockScenarioName,
  setupHandlers?: () => void,
): Promise<void> {
  server.server.resetHandlers()
  server.reset(scenario)
  if (setupHandlers !== undefined) {
    setupHandlers()
  }
  window.localStorage.clear()
  await seedAuthenticatedSession()
  renderAppAt('/ship')
  await waitForUi(() => screen.queryByRole('button', { name: 'Repair Ship' }) !== null)
}

function bearerOf(request: Request): string | undefined {
  return request.headers.get('Authorization')?.replace(/^Bearer /u, '')
}

describe('Ship page', () => {
  it('shows the healthy Ship: hull gauge, materials, level, and last update', async () => {
    await renderShip('established-player')

    const gauge = await screen.findByRole('progressbar', { name: 'Hull health' })
    expect(gauge).toHaveAttribute('aria-valuenow', '96')
    expect(gauge).toHaveAttribute('aria-valuemax', '100')
    expect(screen.getByText('96 / 100')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Materials' })).toBeInTheDocument()
    expect(screen.getByText('250')).toBeInTheDocument()
    expect(screen.getByText(/Level 3 · Updated/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Repair Ship' })).toBeEnabled()
  })

  it('explains repair mechanics on a damaged repairable Ship', async () => {
    await renderShip('damaged-ship')

    const gauge = await screen.findByRole('progressbar', { name: 'Hull health' })
    expect(gauge).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByText('42 / 100')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText(/each material restores a variable amount/i)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Repair Ship' })).toBeEnabled()
  })

  it('repairs pessimistically, updates the Ship from the response, and announces success', async () => {
    const user = userEvent.setup()
    await renderShip('damaged-ship')

    await user.click(await screen.findByRole('button', { name: 'Repair Ship' }))

    expect(await screen.findByText('100 / 100')).toBeInTheDocument()
    expect(screen.getByText('62')).toBeInTheDocument()
    expect(await screen.findByText('The Ship was repaired.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repair Ship' })).toBeDisabled()
    expect(screen.getByText(/Hull is full/)).toBeInTheDocument()
    // The now-disabled Repair control hands focus to the status summary.
    expect(screen.getByRole('heading', { name: 'Ship status' })).toHaveFocus()
  })

  it('disables only the repair control while pending and keeps navigation usable', async () => {
    enableFakeTimers(FIXED_MOCK_EPOCH_MS)
    await renderShipFake('damaged-ship', () => {
      server.server.use(
        http.post('/api/ship/ships/repair', async ({ request }) => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 1_000)
          })
          return HttpResponse.json(server.backend.repairShip(bearerOf(request)), { status: 200 })
        }),
      )
    })

    const repair = screen.getByRole('button', { name: 'Repair Ship' })
    fireEvent.click(repair)

    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('link', { name: 'Dailies' }))

    await waitForUi(() => screen.queryByRole('heading', { level: 1, name: 'Dailies' }) !== null)
    expect(screen.getByRole('heading', { level: 1, name: 'Dailies' })).toBeInTheDocument()

    // Resolve the in-flight repair so no request stays dangling.
    await advanceFake(1_000)
  })

  it('explains a full hull typed error and points to Dailies', async () => {
    const user = userEvent.setup()
    await renderShip('damaged-ship')
    server.server.use(
      http.post('/api/ship/ships/repair', () =>
        HttpResponse.json(
          {
            error: { code: 'SHIP_HULL_FULL', message: 'The hull is already at full health.' },
          },
          { status: 422 },
        ),
      ),
    )

    await user.click(await screen.findByRole('button', { name: 'Repair Ship' }))

    const outcome = await screen.findByText(
      /Repair becomes available when the hull is damaged — complete Dailies to keep the Ship healthy/,
    )
    expect(outcome).toBeInTheDocument()
    const dailiesLink = screen.getByRole('link', { name: 'Open Dailies' })
    expect(dailiesLink).toHaveFocus()
    await user.click(dailiesLink)
    expect(await screen.findByRole('heading', { level: 1, name: 'Dailies' })).toBeInTheDocument()
  })

  it('explains an insufficient-materials typed error and points to Dailies', async () => {
    const user = userEvent.setup()
    await renderShip('damaged-ship')
    server.server.use(
      http.post('/api/ship/ships/repair', () =>
        HttpResponse.json(
          {
            error: {
              code: 'SHIP_INSUFFICIENT_MATERIALS',
              message: 'There are no materials to spend.',
            },
          },
          { status: 422 },
        ),
      ),
    )

    await user.click(await screen.findByRole('button', { name: 'Repair Ship' }))

    expect(
      await screen.findByText(
        /There are no materials to spend\. Complete Dailies to earn materials/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Dailies' })).toBeInTheDocument()
  })

  it('shows Preparing… while the Ship provisions and retries into a ready Ship', async () => {
    const user = userEvent.setup()
    await renderShip('provisioning')

    expect(await screen.findByText('Preparing…')).toBeInTheDocument()
    expect(screen.getByText('Preparing your Ship')).toBeInTheDocument()

    scheduler.advance(5_000)
    server.server.use(
      http.get('/api/ship/ships/me', () => HttpResponse.json(createDamagedShip(), { status: 200 })),
    )

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('progressbar', { name: 'Hull health' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    )
  })

  it('shows an unavailable state with Retry when the initial read fails', async () => {
    const user = userEvent.setup()
    await renderShip('established-player', () => {
      server.server.use(
        http.get('/api/ship/ships/me', () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'Ship service failed.' } },
            { status: 500 },
          ),
        ),
      )
    })

    // Covers the query's single retry (1 s exponential backoff) before it
    // settles into the unavailable state.
    expect(
      await screen.findByText('Ship status is unavailable', undefined, { timeout: 2_000 }),
    ).toBeInTheDocument()

    server.server.resetHandlers()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('progressbar', { name: 'Hull health' })).toHaveAttribute(
      'aria-valuenow',
      '96',
    )
  })

  it('explains an unavailable full hull and points to Dailies', async () => {
    await renderShip('established-player', () => {
      server.server.use(
        http.get('/api/ship/ships/me', () =>
          HttpResponse.json(createDamagedShip({ hull_health: 100 }), { status: 200 }),
        ),
      )
    })

    const repair = await screen.findByRole('button', { name: 'Repair Ship' })
    expect(repair).toBeDisabled()
    expect(repair).toHaveAccessibleDescription(expect.stringContaining('Hull is full'))
    expect(screen.getByRole('link', { name: 'Open Dailies' })).toBeInTheDocument()
  })

  it('explains a zero-materials Ship and points to Dailies', async () => {
    await renderShip('established-player', () => {
      server.server.use(
        http.get('/api/ship/ships/me', () =>
          HttpResponse.json(createDamagedShip({ materials_balance: 0 }), { status: 200 }),
        ),
      )
    })

    const repair = await screen.findByRole('button', { name: 'Repair Ship' })
    expect(repair).toBeDisabled()
    expect(repair).toHaveAccessibleDescription(expect.stringContaining('No materials'))
    expect(screen.getByRole('link', { name: 'Open Dailies' })).toBeInTheDocument()
  })
})
