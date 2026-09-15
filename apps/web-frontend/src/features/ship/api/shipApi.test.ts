import { ApiTransport } from '@/api/transport'
import { createDamagedShip, createExpeditionQuote } from '@/mocks'
import { describe, expect, it, vi } from 'vitest'

import {
  getShip,
  probeExpeditionReadiness,
  repairShip,
  shipQueryKey,
  type ShipState,
} from './shipApi'

describe('ship API adapter', () => {
  it('owns the query key and reads the Ship over GET /ships/me', async () => {
    const seen: { url: string; method: string; body: string | undefined } = {
      url: '',
      method: '',
      body: undefined,
    }
    const transport = new ApiTransport({
      fetch: (input, init) => {
        seen.url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        seen.method = init?.method ?? 'GET'
        seen.body = init?.body as string | undefined
        return Promise.resolve(jsonResponse(createDamagedShip()))
      },
    })

    const state: ShipState = await getShip(transport)
    expect(shipQueryKey).toEqual(['ship'])
    expect(state).toMatchObject({ kind: 'ready', ship: { hull_health: 42 } })
    expect(seen).toEqual({ url: '/api/ship/ships/me', method: 'GET', body: undefined })
  })

  it('repairs the Ship with an empty-body POST and no query', async () => {
    const seen: { url: string; method: string; body: string | undefined } = {
      url: '',
      method: '',
      body: undefined,
    }
    const transport = new ApiTransport({
      fetch: (input, init) => {
        seen.url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        seen.method = init?.method ?? 'GET'
        seen.body = init?.body as string | undefined
        return Promise.resolve(
          jsonResponse(createDamagedShip({ hull_health: 100, materials_balance: 62 })),
        )
      },
    })

    await expect(repairShip(transport)).resolves.toMatchObject({ hull_health: 100 })
    expect(seen).toEqual({ url: '/api/ship/ships/repair', method: 'POST', body: undefined })
  })

  it('maps a missing Ship into a provisioning outcome', async () => {
    const transport = new ApiTransport({
      fetch: vi
        .fn()
        .mockResolvedValue(
          errorResponse({ code: 'SHIP_NOT_FOUND', message: 'Ship has not been provisioned' }, 404),
        ) as typeof globalThis.fetch,
    })

    await expect(getShip(transport)).resolves.toMatchObject({ kind: 'provisioning' })
  })

  it('rethrows non-provisioning failures from the read', async () => {
    const transport = new ApiTransport({
      fetch: vi
        .fn()
        .mockResolvedValue(
          errorResponse({ code: 'INTERNAL_ERROR', message: 'Ship service failed' }, 500),
        ) as typeof globalThis.fetch,
    })

    await expect(getShip(transport)).rejects.toMatchObject({ kind: 'api', code: 'INTERNAL_ERROR' })
  })

  it('probes Expedition readiness through the quote endpoint', async () => {
    let url = ''
    const transport = new ApiTransport({
      fetch: (input) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        return Promise.resolve(jsonResponse(createExpeditionQuote()))
      },
    })

    // The fixture's projected balance matches a fresh damaged Ship's balance.
    await expect(probeExpeditionReadiness(transport, 120)).resolves.toBe(true)
    await expect(probeExpeditionReadiness(transport, 62)).resolves.toBe(false)
    expect(url).toBe('/api/expedition/expeditions/quote?materials_invested=0')
  })

  it('treats a not-ready Expedition outcome as a failed probe', async () => {
    const transport = new ApiTransport({
      fetch: vi.fn().mockResolvedValue(
        errorResponse(
          {
            code: 'EXPEDITION_SHIP_STATE_NOT_READY',
            message: 'Ship state is still provisioning.',
          },
          503,
        ),
      ) as typeof globalThis.fetch,
    })

    await expect(probeExpeditionReadiness(transport, 120)).resolves.toBe(false)
  })
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}

function errorResponse(error: { code: string; message: string }, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
