import { zShipGetMeResponse, zShipRepairResponse } from '@/api/generated/ship/zod.gen'
import { isApiHttpError, type ApiHttpError, type ApiTransport } from '@/api/transport'
import { captureDownstreamSession, onClearDownstreamObservations } from '@/shared/reconciliation'

export const shipQueryKey = ['ship'] as const

export type ShipState =
  | { readonly kind: 'ready'; readonly ship: Awaited<ReturnType<typeof zShipGetMeResponse.parse>> }
  | { readonly kind: 'provisioning'; readonly error: ApiHttpError }

let shipFetchGeneration = 0
let shipCommandRevision = 0
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

/** Monotonic revision of command-published authoritative snapshots. */
export function getShipCommandRevision(): number {
  return shipCommandRevision
}

/** A command-published authoritative snapshot also invalidates older reads. */
export function markShipPublished(state: ShipState): void {
  shipCommandRevision += 1
  markFetched(state)
}

onClearDownstreamObservations(() => {
  shipFetchGeneration += 1
  shipCommandRevision += 1
  lastFetchedShipState = undefined
})

export async function getShip(transport: ApiTransport, signal?: AbortSignal): Promise<ShipState> {
  const session = captureDownstreamSession()
  const commandRevision = getShipCommandRevision()
  const assertStillCurrent = (): void => {
    if (!session.isCurrent() || commandRevision !== getShipCommandRevision()) {
      throw new Error('Ship read belongs to a retired session or was superseded by a command.')
    }
  }
  try {
    const ship = await transport.request({
      service: 'ship',
      path: '/ships/me',
      response: zShipGetMeResponse,
      signal,
    })
    assertStillCurrent()
    return markFetched({ kind: 'ready', ship })
  } catch (error: unknown) {
    if (isApiHttpError(error, 'SHIP_NOT_FOUND')) {
      assertStillCurrent()
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
