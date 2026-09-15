import { describe, expect, it, vi } from 'vitest'

import { ApiTransport } from '@/api/transport'

import {
  currentExpeditionQueryKey,
  expeditionDetailQueryKeyFor,
  expeditionHistoryPageQueryKey,
  expeditionQuoteQueryKeyFor,
  getCurrentExpedition,
  getExpeditionById,
  getExpeditionQuote,
  launchExpedition,
  listExpeditions,
} from './expeditionApi'

const EXPEDITION = {
  id: '00000002-0000-4000-8000-000000000001',
  user_id: '1f8fad5b-d9cb-469f-a165-70867728950e',
  materials_invested: 40,
  success_chance: 0.62,
  resolve_at: '2026-01-15T10:00:00.000Z',
  status: 'IN_FLIGHT',
  created_at: '2026-01-15T08:30:00.000Z',
}

type CapturedRequest = { url: string; method: string; body: string }

function fetchCapturing(records: CapturedRequest[], body: unknown = EXPEDITION) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    records.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
    })
    return Promise.resolve(jsonResponse(body))
  }
}

describe('expedition API adapter', () => {
  it('owns the current query key and keeps the current/none/not_ready narrowing', async () => {
    expect(currentExpeditionQueryKey).toEqual(['expeditions', 'current'])
    const transport = new ApiTransport({
      fetch: vi.fn().mockResolvedValue(jsonResponse(EXPEDITION)) as typeof globalThis.fetch,
    })

    await expect(getCurrentExpedition(transport)).resolves.toEqual({
      kind: 'current',
      expedition: EXPEDITION,
    })
  })

  it.each([
    ['EXPEDITION_NOT_FOUND', 404, { kind: 'none' }],
    ['EXPEDITION_SHIP_STATE_NOT_READY', 503, { kind: 'not_ready' }],
  ])('maps %s into its typed outcome', async (code, status, expected) => {
    const transport = new ApiTransport({
      fetch: vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { code, message: 'not available' } }, { status }),
        ) as typeof globalThis.fetch,
    })

    await expect(getCurrentExpedition(transport)).resolves.toMatchObject(expected)
  })

  it('queries the quote with materials_invested in the query and key', async () => {
    const records: CapturedRequest[] = []
    const transport = new ApiTransport({
      fetch: fetchCapturing(records, {
        materials_invested: 40,
        normalized_investment: 0.16,
        projected_balance: 210,
        success_chance: 0.152,
        eligible: true,
        blocker: null,
        cooldown_until: null,
        estimated_resolve_at: '2026-01-15T11:00:00.000Z',
        estimated_resolve_window_seconds: 3600,
      }),
    })

    await expect(getExpeditionQuote(transport, 40)).resolves.toMatchObject({ eligible: true })
    expect(records[0]?.url).toBe('/api/expedition/expeditions/quote?materials_invested=40')
    expect(expeditionQuoteQueryKeyFor(40)).toEqual(['expeditions', 'quote', 40])
  })

  it('lists expedition history pages with explicit limit and offset', async () => {
    const records: CapturedRequest[] = []
    const transport = new ApiTransport({
      fetch: fetchCapturing(records, [EXPEDITION]),
    })

    await expect(listExpeditions(transport, { limit: 10, offset: 20 })).resolves.toEqual([
      EXPEDITION,
    ])
    expect(records[0]?.url).toBe('/api/expedition/expeditions?limit=10&offset=20')
    expect(expeditionHistoryPageQueryKey(10)).toEqual(['expeditions', 'history', { limit: 10 }])
  })

  it('fetches a single expedition by id through its detail key', async () => {
    const records: CapturedRequest[] = []
    const transport = new ApiTransport({
      fetch: fetchCapturing(records),
    })

    await expect(getExpeditionById(transport, 'abc-123')).resolves.toEqual(EXPEDITION)
    expect(records[0]?.url).toBe('/api/expedition/expeditions/abc-123')
    expect(records[0]?.method).toBe('GET')
    expect(expeditionDetailQueryKeyFor('abc-123')).toEqual(['expeditions', 'detail', 'abc-123'])
  })

  it('launches with a POST body and the generated response schema', async () => {
    const records: CapturedRequest[] = []
    const transport = new ApiTransport({
      fetch: fetchCapturing(records),
    })

    await expect(launchExpedition(transport, 40)).resolves.toEqual(EXPEDITION)
    expect(records[0]?.url).toBe('/api/expedition/expeditions/launch')
    expect(records[0]?.method).toBe('POST')
    expect(records[0]?.body).toBe('{"materials_invested":40}')
  })
})

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  })
}
