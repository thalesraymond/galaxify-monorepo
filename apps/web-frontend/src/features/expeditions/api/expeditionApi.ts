import {
  zExpedition,
  zExpeditionCurrentResponse,
  zExpeditionGetResponse,
  zExpeditionLaunchResponse,
  zExpeditionListResponse,
  zExpeditionQuoteResponse,
} from '@/api/generated/expedition/zod.gen'
import type { LaunchExpeditionRequest } from '@/api/generated/expedition/types.gen'
import { isApiHttpError, type ApiHttpError, type ApiTransport } from '@/api/transport'

/**
 * Feature-owned wire types derived from the generated Zod schemas. The
 * generated `types.gen.ts` shapes use `property?: T`, which conflicts with
 * `exactOptionalPropertyTypes` once a Zod `.optional()` output (`T | undefined`)
 * flows through; these aliases are the assignable versions.
 */
export type Expedition = Awaited<ReturnType<typeof zExpedition.parse>>
export type ExpeditionQuote = Awaited<ReturnType<typeof zExpeditionQuoteResponse.parse>>

export const currentExpeditionQueryKey = ['expeditions', 'current'] as const

export type CurrentExpedition =
  | {
      readonly kind: 'current'
      readonly expedition: Awaited<ReturnType<typeof zExpeditionCurrentResponse.parse>>
    }
  | { readonly kind: 'none' }
  | { readonly kind: 'not_ready'; readonly error: ApiHttpError }

export async function getCurrentExpedition(
  transport: ApiTransport,
  signal?: AbortSignal,
): Promise<CurrentExpedition> {
  try {
    return {
      kind: 'current',
      expedition: await transport.request({
        service: 'expedition',
        path: '/expeditions/current',
        response: zExpeditionCurrentResponse,
        ...(signal === undefined ? {} : { signal }),
      }),
    }
  } catch (error: unknown) {
    if (isApiHttpError(error, 'EXPEDITION_NOT_FOUND')) {
      return { kind: 'none' }
    }
    if (isApiHttpError(error, 'EXPEDITION_SHIP_STATE_NOT_READY')) {
      return { kind: 'not_ready', error }
    }
    throw error
  }
}

export const expeditionQuoteQueryKey = ['expeditions', 'quote'] as const

export function expeditionQuoteQueryKeyFor(materialsInvested: number) {
  return [...expeditionQuoteQueryKey, materialsInvested] as const
}

export function getExpeditionQuote(
  transport: ApiTransport,
  materialsInvested: number,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<typeof zExpeditionQuoteResponse.parse>>> {
  return transport.request({
    service: 'expedition',
    path: '/expeditions/quote',
    query: { materials_invested: materialsInvested },
    response: zExpeditionQuoteResponse,
    ...(signal === undefined ? {} : { signal }),
  })
}

export const expeditionHistoryQueryKey = ['expeditions', 'history'] as const

export function expeditionHistoryPageQueryKey(limit: number) {
  return [...expeditionHistoryQueryKey, { limit }] as const
}

export type ExpeditionHistoryPageQuery = {
  readonly limit: number
  readonly offset: number
}

export function listExpeditions(
  transport: ApiTransport,
  query: ExpeditionHistoryPageQuery,
  signal?: AbortSignal,
): Promise<Expedition[]> {
  return transport.request({
    service: 'expedition',
    path: '/expeditions',
    query: { limit: query.limit, offset: query.offset },
    response: zExpeditionListResponse,
    ...(signal === undefined ? {} : { signal }),
  })
}

export function expeditionHistoryPageOptions(transport: ApiTransport, limit: number) {
  return {
    queryKey: expeditionHistoryPageQueryKey(limit),
    queryFn: ({ pageParam, signal }: { pageParam: number; signal: AbortSignal }) =>
      listExpeditions(transport, { limit, offset: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage: Expedition[], _allPages: Expedition[][], lastPageParam: number) =>
      lastPage.length < limit ? undefined : lastPageParam + limit,
  } as const
}

export const expeditionDetailQueryKey = ['expeditions', 'detail'] as const

export function expeditionDetailQueryKeyFor(id: string) {
  return [...expeditionDetailQueryKey, id] as const
}

export function getExpeditionById(
  transport: ApiTransport,
  id: string,
  signal?: AbortSignal,
): Promise<Expedition> {
  return transport.request({
    service: 'expedition',
    path: `/expeditions/${id}`,
    response: zExpeditionGetResponse,
    ...(signal === undefined ? {} : { signal }),
  })
}

export function launchExpedition(
  transport: ApiTransport,
  materialsInvested: number,
): Promise<Expedition> {
  const body: LaunchExpeditionRequest = { materials_invested: materialsInvested }
  return transport.request({
    service: 'expedition',
    path: '/expeditions/launch',
    method: 'POST',
    body,
    response: zExpeditionLaunchResponse,
  })
}
