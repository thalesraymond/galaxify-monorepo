import { zExpeditionCurrentResponse } from '@/api/generated/expedition/zod.gen'
import { isApiHttpError, type ApiHttpError, type ApiTransport } from '@/api/transport'

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
        signal,
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
