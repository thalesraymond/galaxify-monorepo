import { zShipGetMeResponse, zShipRepairResponse } from '@/api/generated/ship/zod.gen'
import { isApiHttpError, type ApiHttpError, type ApiTransport } from '@/api/transport'

export const shipQueryKey = ['ship'] as const

export type ShipState =
  | { readonly kind: 'ready'; readonly ship: Awaited<ReturnType<typeof zShipGetMeResponse.parse>> }
  | { readonly kind: 'provisioning'; readonly error: ApiHttpError }

let shipFetchGeneration = 0
let lastFetchedShipState: ShipState | undefined

/** Marker used to distinguish a real fetch from a reverted/cached read. */
export function getShipFetchMark(): {
  readonly generation: number
  readonly state: ShipState | undefined
} {
  return { generation: shipFetchGeneration, state: lastFetchedShipState }
}

function markFetched(state: ShipState): ShipState {
  shipFetchGeneration += 1
  lastFetchedShipState = state
  return state
}

export async function getShip(transport: ApiTransport, signal?: AbortSignal): Promise<ShipState> {
  try {
    return markFetched({
      kind: 'ready',
      ship: await transport.request({
        service: 'ship',
        path: '/ships/me',
        response: zShipGetMeResponse,
        signal,
      }),
    })
  } catch (error: unknown) {
    if (isApiHttpError(error, 'SHIP_NOT_FOUND')) {
      return markFetched({ kind: 'provisioning', error })
    }
    throw error
  }
}

/** Pessimistic repair command (`web-frontend.md` §3.3): POST with no body. */
export function repairShip(
  transport: ApiTransport,
): Promise<Awaited<ReturnType<typeof zShipRepairResponse.parse>>> {
  return transport.request({
    service: 'ship',
    path: '/ships/repair',
    method: 'POST',
    response: zShipRepairResponse,
  })
}
