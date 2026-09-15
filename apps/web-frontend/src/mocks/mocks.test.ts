import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MOCK_RESPONSE_DELAY_MS,
  FIXED_DAILY_IDS,
  FIXED_MOCK_EPOCH_MS,
  FIXED_USER_ID,
  InMemoryMockStateStore,
  LocalStorageMockStateStore,
  ManualMockScheduler,
  MOCK_STATE_STORAGE_KEY,
  MOCK_STATE_VERSION,
  MockBackend,
  createEstablishedDailies,
  createMockTestServer,
  createPlayer,
  mockScenarioNames,
  onUnhandledMockRequest,
  parseMockScenario,
} from './index'

const BASE = 'http://localhost:3000'
const PASSWORD = 'password123'

type MockServer = ReturnType<typeof createMockTestServer>

async function withMockServer<T>(
  options: Parameters<typeof createMockTestServer>[0],
  run: (env: MockServer) => Promise<T>,
): Promise<T> {
  const env = createMockTestServer(options)
  env.server.listen({ onUnhandledRequest: onUnhandledMockRequest })
  try {
    return await run(env)
  } finally {
    env.server.close()
  }
}

async function readJson(response: Response): Promise<unknown> {
  return (await response.json()) as unknown
}

function jsonRequest(body: unknown, accessToken?: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` }),
    },
    body: JSON.stringify(body),
  }
}

async function login(): Promise<{ access_token: string; refresh_token: string }> {
  const response = await fetch(
    `${BASE}/api/user/auth/login`,
    jsonRequest({ email: 'captain@galaxify.test', password: PASSWORD }),
  )
  return (await readJson(response)) as { access_token: string; refresh_token: string }
}

function auth(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } }
}

describe('named mock scenarios', () => {
  it('registers all ten named scenarios with established-player as the default', () => {
    expect(mockScenarioNames).toEqual([
      'anonymous',
      'provisioning',
      'established-player',
      'damaged-ship',
      'expedition-ready',
      'active-expedition',
      'resolved-expedition',
      'expired-session',
      'service-outage',
      'delayed-propagation',
    ])
    expect(parseMockScenario(undefined)).toBe('established-player')
    expect(parseMockScenario('')).toBe('established-player')
  })

  it('rejects an unknown scenario listing every valid name', () => {
    expect(() => parseMockScenario('nope')).toThrow('established-player')
    expect(() => parseMockScenario('nope')).toThrow('delayed-propagation')
  })
})

describe('manual scheduler', () => {
  it('runs scheduled tasks deterministically on advance and runAll', () => {
    const scheduler = new ManualMockScheduler(FIXED_MOCK_EPOCH_MS)
    const order: string[] = []
    scheduler.schedule(10, () => order.push('a'))
    scheduler.schedule(5, () => order.push('b'))

    expect(scheduler.now()).toBe(FIXED_MOCK_EPOCH_MS)
    scheduler.advance(4)
    expect(order).toEqual([])
    scheduler.advance(1)
    expect(order).toEqual(['b'])
    scheduler.runAll()
    expect(order).toEqual(['b', 'a'])
  })
})

describe('fixed factories', () => {
  it('produces byte-identical fixtures without randomness or wall-clock reads', () => {
    expect(createPlayer()).toEqual(createPlayer())
    expect(createEstablishedDailies()).toEqual(createEstablishedDailies())
    expect(createPlayer().id).toBe(FIXED_USER_ID)
    expect(createEstablishedDailies()[0]?.id).toBe(FIXED_DAILY_IDS.calibrate)
  })
})

describe('mock backend and strict MSW handlers', () => {
  it('serves the established-player journey over the generated contracts', async () => {
    await withMockServer({ scenario: 'established-player' }, async () => {
      const session = await login()
      expect(session.access_token).toMatch(/^[^.]+\.[^.]+\.[^.]+$/)

      const me = await fetch(`${BASE}/api/user/users/me`, auth(session.access_token))
      expect(me.status).toBe(200)
      expect(((await readJson(me)) as { id: string }).id).toBe(FIXED_USER_ID)

      const dailies = await fetch(`${BASE}/api/daily/dailies`, auth(session.access_token))
      expect(dailies.status).toBe(200)
      expect(await readJson(dailies)).toHaveLength(3)

      const filtered = await fetch(
        `${BASE}/api/daily/dailies?status=PENDING`,
        auth(session.access_token),
      )
      expect(await readJson(filtered)).toHaveLength(2)

      const ship = await fetch(`${BASE}/api/ship/ships/me`, auth(session.access_token))
      expect(((await readJson(ship)) as { hull_health: number }).hull_health).toBe(96)

      const quote = await fetch(
        `${BASE}/api/expedition/expeditions/quote?materials_invested=40`,
        auth(session.access_token),
      )
      const quoteBody = (await readJson(quote)) as { eligible: boolean; success_chance: number }
      expect(quoteBody.eligible).toBe(true)
      expect(quoteBody.success_chance).toBeLessThanOrEqual(1)

      const launch = await fetch(
        `${BASE}/api/expedition/expeditions/launch`,
        jsonRequest({ materials_invested: 40 }, session.access_token),
      )
      expect(launch.status).toBe(201)
    })
  })

  it('gives resolved-expedition a distinct journey from established-player', async () => {
    await withMockServer({ scenario: 'resolved-expedition' }, async () => {
      const session = await login()

      const dailies = await fetch(`${BASE}/api/daily/dailies`, auth(session.access_token))
      expect(dailies.status).toBe(200)
      expect(await readJson(dailies)).toHaveLength(0)

      const expeditions = await fetch(
        `${BASE}/api/expedition/expeditions`,
        auth(session.access_token),
      )
      expect(expeditions.status).toBe(200)
      expect(await readJson(expeditions)).toHaveLength(2)
    })
  })

  it('continues Daily history with an opaque cursor and rejects forged tokens', async () => {
    await withMockServer({ scenario: 'established-player' }, async () => {
      const session = await login()

      const first = await fetch(
        `${BASE}/api/daily/dailies/history?limit=1`,
        auth(session.access_token),
      )
      const firstPage = (await readJson(first)) as {
        items: unknown[]
        next_cursor: string | null
      }
      expect(firstPage.items).toHaveLength(1)
      expect(firstPage.next_cursor).not.toBeNull()
      expect(firstPage.next_cursor).not.toMatch(/^\d+$/u)

      const second = await fetch(
        `${BASE}/api/daily/dailies/history?limit=1&cursor=${encodeURIComponent(firstPage.next_cursor ?? '')}`,
        auth(session.access_token),
      )
      const secondPage = (await readJson(second)) as { items: unknown[] }
      expect(secondPage.items).toHaveLength(1)

      const forged = await fetch(
        `${BASE}/api/daily/dailies/history?cursor=not-a-cursor`,
        auth(session.access_token),
      )
      expect(forged.status).toBe(422)
    })
  })

  it('echoes a caller request ID and fails unhandled /api/** requests loudly', async () => {
    await withMockServer({ scenario: 'established-player' }, async () => {
      const health = await fetch(`${BASE}/api/user/health`, {
        headers: { 'X-Request-Id': 'request-42' },
      })
      expect(health.headers.get('X-Request-Id')).toBe('request-42')

      const unhandled = await fetch(`${BASE}/api/mystery/route`)
      expect(unhandled.status).toBe(501)
      expect(((await readJson(unhandled)) as { error: { code: string } }).error.code).toBe(
        'MOCK_UNHANDLED_REQUEST',
      )
    })
  })

  it('rotates single-use refresh tokens and invalidates a reused family', async () => {
    await withMockServer({ scenario: 'established-player' }, async () => {
      const first = await login()
      const rotated = await fetch(
        `${BASE}/api/user/auth/refresh`,
        jsonRequest({ refresh_token: first.refresh_token }),
      )
      expect(rotated.status).toBe(200)
      const second = (await readJson(rotated)) as { refresh_token: string }
      expect(second.refresh_token).not.toBe(first.refresh_token)

      const reuse = await fetch(
        `${BASE}/api/user/auth/refresh`,
        jsonRequest({ refresh_token: first.refresh_token }),
      )
      expect(reuse.status).toBe(401)
      expect(((await readJson(reuse)) as { error: { code: string } }).error.code).toBe(
        'AUTH_INVALID_TOKEN',
      )

      const afterInvalidation = await fetch(
        `${BASE}/api/user/auth/refresh`,
        jsonRequest({ refresh_token: second.refresh_token }),
      )
      expect(afterInvalidation.status).toBe(401)
    })
  })

  it('terminates an expired session without exposing protected content', async () => {
    await withMockServer({ scenario: 'expired-session' }, async () => {
      const me = await fetch(`${BASE}/api/user/users/me`, auth('stale-token'))
      expect(me.status).toBe(401)
      expect(((await readJson(me)) as { error: { code: string } }).error.code).toBe(
        'AUTH_INVALID_TOKEN',
      )

      const refresh = await fetch(
        `${BASE}/api/user/auth/refresh`,
        jsonRequest({ refresh_token: 'unknown-token' }),
      )
      expect(refresh.status).toBe(401)
    })
  })

  it('models provisioning as a retryable not-ready window', async () => {
    const scheduler = new ManualMockScheduler(FIXED_MOCK_EPOCH_MS)
    await withMockServer({ scenario: 'provisioning', scheduler }, async () => {
      const session = await login()
      const notReady = await fetch(`${BASE}/api/daily/dailies`, auth(session.access_token))
      expect(notReady.status).toBe(503)
      expect(((await readJson(notReady)) as { error: { code: string } }).error.code).toBe(
        'DAILY_PLAYER_NOT_READY',
      )

      const missingShip = await fetch(`${BASE}/api/ship/ships/me`, auth(session.access_token))
      expect(missingShip.status).toBe(404)

      scheduler.advance(5_000)
      const ready = await fetch(`${BASE}/api/daily/dailies`, auth(session.access_token))
      expect(ready.status).toBe(200)
    })
  })

  it('returns retryable outages per service', async () => {
    await withMockServer({ scenario: 'service-outage' }, async () => {
      const loginResponse = await fetch(
        `${BASE}/api/user/auth/login`,
        jsonRequest({ email: 'captain@galaxify.test', password: PASSWORD }),
      )
      expect(loginResponse.status).toBe(503)
      expect(((await readJson(loginResponse)) as { error: { code: string } }).error.code).toBe(
        'AUTH_SERVICE_UNAVAILABLE',
      )

      const daily = await fetch(`${BASE}/api/daily/dailies`)
      expect(daily.status).toBe(503)

      const ship = await fetch(`${BASE}/api/ship/ships/me`)
      expect(ship.status).toBe(500)
    })
  })

  it('models delayed and permanently-stale propagation through the fake clock', async () => {
    const scheduler = new ManualMockScheduler(FIXED_MOCK_EPOCH_MS)
    await withMockServer({ scenario: 'delayed-propagation', scheduler }, async () => {
      const session = await login()
      const before = await fetch(`${BASE}/api/ship/ships/me`, auth(session.access_token))
      const balance = ((await readJson(before)) as { materials_balance: number }).materials_balance

      const completed = await fetch(
        `${BASE}/api/daily/dailies/${FIXED_DAILY_IDS.calibrate}/complete`,
        { method: 'POST', ...auth(session.access_token) },
      )
      expect(completed.status).toBe(200)

      const duringWindow = await fetch(`${BASE}/api/ship/ships/me`, auth(session.access_token))
      expect(
        ((await readJson(duringWindow)) as { materials_balance: number }).materials_balance,
      ).toBe(balance)

      scheduler.advance(5 * 60 * 1000 + 1)
      const reconciled = await fetch(`${BASE}/api/ship/ships/me`, auth(session.access_token))
      expect(
        ((await readJson(reconciled)) as { materials_balance: number }).materials_balance,
      ).toBe(balance + 10)

      await fetch(
        `${BASE}/api/expedition/expeditions/launch`,
        jsonRequest({ materials_invested: 40 }, session.access_token),
      )
      scheduler.advance(5 * 60 * 1000)
      const permanentlyStale = await fetch(`${BASE}/api/ship/ships/me`, auth(session.access_token))
      // The expedition deduction never lands: the consumer is permanently stale.
      expect(
        ((await readJson(permanentlyStale)) as { materials_balance: number }).materials_balance,
      ).toBe(balance + 10)
    })
  })

  it('resolves an in-flight Expedition deterministically once the clock passes resolve_at', async () => {
    const scheduler = new ManualMockScheduler(FIXED_MOCK_EPOCH_MS)
    await withMockServer({ scenario: 'active-expedition', scheduler }, async () => {
      const session = await login()

      const current = await fetch(
        `${BASE}/api/expedition/expeditions/current`,
        auth(session.access_token),
      )
      const inFlight = (await readJson(current)) as { id: string; status: string }
      expect(inFlight.status).toBe('IN_FLIGHT')

      // Cross the fixed resolve time (fixed epoch + 1h): the next read
      // materializes a deterministic SUCCESS result and clears "current". The
      // original access token has also passed its 15-minute mock lifetime, so
      // the session rotates first — exactly what the browser transport does.
      scheduler.advance(60 * 60 * 1000)
      const rotated = await fetch(
        `${BASE}/api/user/auth/refresh`,
        jsonRequest({ refresh_token: session.refresh_token }),
      )
      expect(rotated.status).toBe(200)
      const refreshed = (await readJson(rotated)) as { access_token: string }
      const bearer = auth(refreshed.access_token)

      const after = await fetch(`${BASE}/api/expedition/expeditions/current`, bearer)
      expect(after.status).toBe(404)

      const detail = await fetch(`${BASE}/api/expedition/expeditions/${inFlight.id}`, bearer)
      const resolved = (await readJson(detail)) as {
        status: string
        resolved_at: string
        result: { outcome: string; material_reward: { materials: number } }
      }
      expect(resolved.status).toBe('RESOLVED')
      expect(resolved.result.outcome).toBe('SUCCESS')
      // 40 invested * 2, matching the resolved fixture reward.
      expect(resolved.result.material_reward.materials).toBe(80)

      // The Ship reward lands only after the propagation window elapses.
      const before = await fetch(`${BASE}/api/ship/ships/me`, bearer)
      expect(((await readJson(before)) as { materials_balance: number }).materials_balance).toBe(
        250,
      )
      scheduler.advance(2_000 + 1)
      const afterShip = await fetch(`${BASE}/api/ship/ships/me`, bearer)
      expect(((await readJson(afterShip)) as { materials_balance: number }).materials_balance).toBe(
        330,
      )
    })
  })

  it('resets deterministically and defaults to the fixed response delay', () => {
    const backend = new MockBackend({ scenario: 'established-player' })
    expect(backend.getScenario()).toBe('established-player')
    expect(DEFAULT_MOCK_RESPONSE_DELAY_MS).toBeGreaterThan(0)

    backend.reset('damaged-ship')
    expect(backend.getScenario()).toBe('damaged-ship')
  })

  it('isolates automated state in memory and namespaces its version', () => {
    const store = new InMemoryMockStateStore()
    expect(store.load()).toBeUndefined()
    expect(new MockBackend({ scenario: 'established-player', store })).toBeDefined()

    const persisted = store.load()
    expect(persisted?.scenario).toBe('established-player')
    expect(persisted?.namespace).toBe('galaxify.mock')
    expect(persisted?.version).toBe(MOCK_STATE_VERSION)
    expect(MOCK_STATE_STORAGE_KEY).toBe(`galaxify.mock.v${MOCK_STATE_VERSION}`)
  })

  it('persists namespaced state across store instances (reload) and resets it', () => {
    window.localStorage.clear()
    const store = new LocalStorageMockStateStore(window.localStorage)
    expect(new MockBackend({ scenario: 'damaged-ship', store })).toBeDefined()

    const reloaded = new LocalStorageMockStateStore(window.localStorage)
    expect(reloaded.load()?.scenario).toBe('damaged-ship')
    reloaded.clear()
    expect(reloaded.load()).toBeUndefined()
    store.dispose()
    reloaded.dispose()
  })
})
