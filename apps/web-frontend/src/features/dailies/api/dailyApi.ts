import { zDailyListResponse } from '@/api/generated/daily/zod.gen'
import type { ApiQuery, ApiTransport } from '@/api/transport'

export const dailiesQueryKey = (filters: ApiQuery = {}) => ['dailies', filters] as const

export function listDailies(transport: ApiTransport, filters: ApiQuery = {}, signal?: AbortSignal) {
  return transport.request({
    service: 'daily',
    path: '/dailies',
    query: filters,
    response: zDailyListResponse,
    signal,
  })
}
