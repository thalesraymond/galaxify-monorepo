import { zShipGetMeResponse } from '@/api/generated/ship/zod.gen'
import { isApiTransportError, type ApiHttpError, type ApiTransport } from '@/api/transport'

export const shipQueryKey = ['ship'] as const

export type ShipState =
  | { readonly kind: 'ready'; readonly ship: Awaited<ReturnType<typeof zShipGetMeResponse.parse>> }
  | { readonly kind: 'provisioning'; readonly error: ApiHttpError }

export async function getShip(transport: ApiTransport, signal?: AbortSignal): Promise<ShipState> {
  try {
    return {
      kind: 'ready',
      ship: await transport.request({
        service: 'ship',
        path: '/ships/me',
        response: zShipGetMeResponse,
        signal,
      }),
    }
  } catch (error: unknown) {
    if (isApiError(error, 'SHIP_NOT_FOUND')) {
      return { kind: 'provisioning', error }
    }
    throw error
  }
}

function isApiError(error: unknown, code: string): error is ApiHttpError {
  return isApiTransportError(error) && error.kind === 'api' && error.code === code
}
