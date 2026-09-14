import { ApiTransport } from '@/api/transport'
import { describe, expect, it } from 'vitest'

import { dailiesQueryKey, listDailies } from './dailyApi'

describe('dailies API adapter', () => {
  it('owns filters, query key, and the Daily list operation', async () => {
    let url = ''
    const transport = new ApiTransport({
      fetch: (input) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        return Promise.resolve(jsonResponse([daily]))
      },
    })
    const filters = { status: 'PENDING', date: '2026-01-01' }

    await expect(listDailies(transport, filters)).resolves.toEqual([daily])
    expect(dailiesQueryKey(filters)).toEqual(['dailies', filters])
    expect(url).toBe('/api/daily/dailies?status=PENDING&date=2026-01-01')
  })
})

const daily = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  user_id: '1f8fad5b-d9cb-469f-a165-70867728950e',
  title: 'Calibrate sensors',
  description: 'Before launch',
  difficulty: 'EASY',
  due_date: '2026-01-01T12:00:00Z',
  status: 'PENDING',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  time_zone: 'UTC',
  due_local_date: '2026-01-01',
  due_local_time: '12:00',
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}
