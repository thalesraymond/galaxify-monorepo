import { ApiTransport } from '@/api/transport'
import {
  createDaily as fixtureDaily,
  createDailyHistory,
  FIXED_DAILY_IDS,
  FIXED_DIFFICULTY_METADATA,
  fixedUuid,
} from '@/mocks/fixtures'
import { describe, expect, it } from 'vitest'

import type { CreateDailyInput, DailyListFilters } from './dailyApi'
import {
  completeDaily,
  createDaily,
  dailyHistoryQueryKey,
  dailyQueryKey,
  dailiesQueryKey,
  difficultiesQueryKey,
  deleteDaily,
  getDaily,
  listDailyHistory,
  listDailies,
  listDifficulties,
  updateDaily,
} from './dailyApi'

describe('dailies API adapter', () => {
  it('owns filters, query key, and the Daily list operation', async () => {
    let url = ''
    const transport = new ApiTransport({
      fetch: (input) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        return Promise.resolve(jsonResponse([daily]))
      },
    })
    const filters: DailyListFilters = {
      status: 'PENDING',
      from: '2026-01-15T00:00:00Z',
      to: '2026-01-16T00:00:00Z',
    }

    await expect(listDailies(transport, filters)).resolves.toEqual([daily])
    expect(dailiesQueryKey(filters)).toEqual(['dailies', filters])
    expect(url).toBe(
      '/api/daily/dailies?status=PENDING&from=2026-01-15T00%3A00%3A00Z&to=2026-01-16T00%3A00%3A00Z',
    )
  })

  it('omits undefined list filters from the query string', async () => {
    let url = ''
    const transport = new ApiTransport({
      fetch: (input) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        return Promise.resolve(jsonResponse([daily]))
      },
    })

    await listDailies(transport, {})
    expect(url).toBe('/api/daily/dailies')
  })

  it('fetches one Daily by id', async () => {
    let url = ''
    const transport = new ApiTransport({
      fetch: (input) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        return Promise.resolve(jsonResponse(daily))
      },
    })

    await expect(getDaily(transport, daily.id)).resolves.toEqual(daily)
    expect(url).toBe(`/api/daily/dailies/${daily.id}`)
    expect(dailyQueryKey(daily.id)).toEqual(['dailies', 'daily', daily.id])
  })

  it('creates a Daily without sending a deadline', async () => {
    let url = ''
    let method = ''
    let body: unknown
    const transport = new ApiTransport({
      fetch: (input, init) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        method = init?.method ?? 'GET'
        body = init?.body === undefined ? undefined : JSON.parse(init.body as string)
        return Promise.resolve(jsonResponse(daily))
      },
    })
    const input: CreateDailyInput = {
      title: 'Calibrate sensors',
      difficulty: 'EASY',
    }

    await expect(createDaily(transport, input)).resolves.toEqual(daily)
    expect(method).toBe('POST')
    expect(url).toBe('/api/daily/dailies')
    expect(body).toEqual({ ...input, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone })
  })

  it('updates a Daily with a PATCH body', async () => {
    let url = ''
    let method = ''
    let body: unknown
    const transport = new ApiTransport({
      fetch: (input, init) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        method = init?.method ?? 'GET'
        body = init?.body === undefined ? undefined : JSON.parse(init.body as string)
        return Promise.resolve(jsonResponse(daily))
      },
    })
    const patch = { title: 'Recalibrate sensors' }

    await expect(updateDaily(transport, daily.id, patch)).resolves.toEqual(daily)
    expect(method).toBe('PATCH')
    expect(url).toBe(`/api/daily/dailies/${daily.id}`)
    expect(body).toEqual(patch)
  })

  it('deletes a Daily with a 204 no-content expectation', async () => {
    let url = ''
    let method = ''
    const transport = new ApiTransport({
      fetch: (input, init) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        method = init?.method ?? 'GET'
        return Promise.resolve(new Response(null, { status: 204 }))
      },
    })

    await expect(deleteDaily(transport, daily.id)).resolves.toBeUndefined()
    expect(method).toBe('DELETE')
    expect(url).toBe(`/api/daily/dailies/${daily.id}`)
  })

  it('completes a Daily and parses the typed awarded-material effect', async () => {
    let url = ''
    let method = ''
    const completion = { ...daily, awarded_materials: 25 }
    const transport = new ApiTransport({
      fetch: (input, init) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        method = init?.method ?? 'GET'
        return Promise.resolve(jsonResponse(completion))
      },
    })

    await expect(completeDaily(transport, daily.id)).resolves.toEqual(completion)
    expect(method).toBe('POST')
    expect(url).toBe(`/api/daily/dailies/${daily.id}/complete`)
  })

  it('pages Daily History with an opaque cursor and limit', async () => {
    let url = ''
    const page = { items: [historyItem], next_cursor: null }
    const transport = new ApiTransport({
      fetch: (input) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        return Promise.resolve(jsonResponse(page))
      },
    })

    await expect(listDailyHistory(transport, { cursor: 'abc', limit: 10 })).resolves.toEqual(page)
    expect(url).toBe('/api/daily/dailies/history?cursor=abc&limit=10')
    expect(dailyHistoryQueryKey()).toEqual(['dailies', 'history'])
    expect(dailyHistoryQueryKey('abc')).toEqual(['dailies', 'history', 'abc'])
  })

  it('omits an undefined history cursor', async () => {
    let url = ''
    const transport = new ApiTransport({
      fetch: (input) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        return Promise.resolve(jsonResponse({ items: [], next_cursor: null }))
      },
    })

    await listDailyHistory(transport, { limit: 10 })
    expect(url).toBe('/api/daily/dailies/history?limit=10')
  })

  it('lists difficulty metadata', async () => {
    let url = ''
    const difficulties = FIXED_DIFFICULTY_METADATA
    const transport = new ApiTransport({
      fetch: (input) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        return Promise.resolve(jsonResponse(difficulties))
      },
    })

    await expect(listDifficulties(transport)).resolves.toEqual(difficulties)
    expect(url).toBe('/api/daily/dailies/difficulties')
    expect(difficultiesQueryKey).toEqual(['dailies', 'difficulties'])
  })
})

const daily = fixtureDaily(FIXED_DAILY_IDS.calibrate)

const historyItem = createDailyHistory(fixedUuid(3, 1))

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}
