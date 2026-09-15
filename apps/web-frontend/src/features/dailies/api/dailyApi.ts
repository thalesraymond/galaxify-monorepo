import {
  zDailyCompleteResponse,
  zDailyCreateResponse,
  zDailyDeleteResponse,
  zDailyDifficultiesResponse,
  zDailyGetResponse,
  zDailyHistoryResponse,
  zDailyListResponse,
  zDailyUpdateResponse,
} from '@/api/generated/daily/zod.gen'
import type {
  Daily,
  DailyCompletion,
  DailyDifficulty,
  DailyHistoryPage,
  DailyStatus,
  Difficulty,
} from '@/api/generated/daily/types.gen'
import type { ApiQuery, ApiTransport } from '@/api/transport'

/** Mutable local query accumulator; the transport accepts the readonly shape. */
type MutableApiQuery = Record<string, string | number | boolean | undefined>

/**
 * Query filters for the current-Dailies list. `from`/`to` are explicit
 * RFC3339 instants (local-midnight range of the selected calendar date); a
 * `status` filter narrows to the pending or completed cycle.
 */
export type DailyListFilters = {
  readonly status?: DailyStatus
  readonly from?: string
  readonly to?: string
}

/** Creation body: the local deadline pair plus zone (spec §5.3 fields). */
export type CreateDailyInput = {
  readonly title: string
  readonly description?: string
  readonly difficulty: Difficulty
  readonly time_zone: string
  readonly due_local_date: string
  readonly due_local_time: string
}

/** Partial update body; the backend retains any omitted field. */
export type UpdateDailyInput = {
  readonly title?: string
  readonly description?: string
  readonly difficulty?: Difficulty
  readonly time_zone?: string
  readonly due_local_date?: string
  readonly due_local_time?: string
}

/** Cursor-pagination filters for Daily History. */
export type DailyHistoryFilters = {
  readonly cursor?: string
  readonly limit?: number
}

export const dailiesQueryKey = (filters: ApiQuery = {}) => ['dailies', filters] as const

export const dailyQueryKey = (id: string) => ['dailies', 'daily', id] as const

/** History pages accumulate under one key; a cursor-bearing key is used by manual pagers. */
export const dailyHistoryQueryKey = (cursor?: string) =>
  cursor === undefined
    ? (['dailies', 'history'] as const)
    : (['dailies', 'history', cursor] as const)

export const difficultiesQueryKey = ['dailies', 'difficulties'] as const

export function listDailies(
  transport: ApiTransport,
  filters: DailyListFilters = {},
  signal?: AbortSignal,
): Promise<Daily[]> {
  const query: MutableApiQuery = {}
  if (filters.status !== undefined) {
    query.status = filters.status
  }
  if (filters.from !== undefined) {
    query.from = filters.from
  }
  if (filters.to !== undefined) {
    query.to = filters.to
  }
  return transport.request({
    service: 'daily',
    path: '/dailies',
    query,
    response: zDailyListResponse,
    signal,
  })
}

export function getDaily(
  transport: ApiTransport,
  id: string,
  signal?: AbortSignal,
): Promise<Daily> {
  return transport.request({
    service: 'daily',
    path: `/dailies/${id}`,
    response: zDailyGetResponse,
    signal,
  })
}

export function createDaily(transport: ApiTransport, body: CreateDailyInput): Promise<Daily> {
  return transport.request({
    service: 'daily',
    path: '/dailies',
    method: 'POST',
    body,
    response: zDailyCreateResponse,
  })
}

export function updateDaily(
  transport: ApiTransport,
  id: string,
  body: UpdateDailyInput,
): Promise<Daily> {
  return transport.request({
    service: 'daily',
    path: `/dailies/${id}`,
    method: 'PATCH',
    body,
    response: zDailyUpdateResponse,
  })
}

export function deleteDaily(transport: ApiTransport, id: string): Promise<void> {
  return transport.request({
    service: 'daily',
    path: `/dailies/${id}`,
    method: 'DELETE',
    response: zDailyDeleteResponse,
  })
}

/** Completes a Daily and returns the typed awarded-material effect (§7.1). */
export function completeDaily(
  transport: ApiTransport,
  id: string,
  signal?: AbortSignal,
): Promise<DailyCompletion> {
  return transport.request({
    service: 'daily',
    path: `/dailies/${id}/complete`,
    method: 'POST',
    response: zDailyCompleteResponse,
    signal,
  })
}

export function listDailyHistory(
  transport: ApiTransport,
  filters: DailyHistoryFilters = {},
  signal?: AbortSignal,
): Promise<DailyHistoryPage> {
  const query: MutableApiQuery = {}
  if (filters.cursor !== undefined) {
    query.cursor = filters.cursor
  }
  if (filters.limit !== undefined) {
    query.limit = filters.limit
  }
  return transport.request({
    service: 'daily',
    path: '/dailies/history',
    query,
    response: zDailyHistoryResponse,
    signal,
  })
}

export function listDifficulties(
  transport: ApiTransport,
  signal?: AbortSignal,
): Promise<DailyDifficulty[]> {
  return transport.request({
    service: 'daily',
    path: '/dailies/difficulties',
    response: zDailyDifficultiesResponse,
    signal,
  })
}
