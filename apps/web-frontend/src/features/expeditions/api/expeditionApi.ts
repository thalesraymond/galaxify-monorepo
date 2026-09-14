import { zExpeditionCurrentResponse } from '@/api/generated/expedition/zod.gen'
import { isApiTransportError, type ApiHttpError, type ApiTransport } from '@/api/transport'

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
    if (isApiError(error, 'EXPEDITION_NOT_FOUND')) {
      return { kind: 'none' }
    }
    if (isApiError(error, 'SHIP_STATE_NOT_READY')) {
      return { kind: 'not_ready', error }
    }
    throw error
  }
}

function isApiError(error: unknown, code: string): error is ApiHttpError {
  return isApiTransportError(error) && error.kind === 'api' && error.code === code
}
