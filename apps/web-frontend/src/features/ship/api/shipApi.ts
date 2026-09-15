import { zExpeditionQuoteResponse } from '@/api/generated/expedition/zod.gen'
import { zShipGetMeResponse, zShipRepairResponse } from '@/api/generated/ship/zod.gen'
import { isApiHttpError, type ApiHttpError, type ApiTransport } from '@/api/transport'

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
    if (isApiHttpError(error, 'SHIP_NOT_FOUND')) {
      return { kind: 'provisioning', error }
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

/**
 * Probes whether the Expedition service has consumed the Ship repair event
 * (`web-frontend.md` §3.4) by reading its quote view of the materials balance.
 * Any readiness failure, outage, or stale balance keeps the probe failing so
 * the UI can bound its reconciliation window.
 */
export async function probeExpeditionReadiness(
  transport: ApiTransport,
  expectedMaterialsBalance: number,
): Promise<boolean> {
  try {
    const quote = await transport.request({
      service: 'expedition',
      path: '/expeditions/quote',
      query: { materials_invested: 0 },
      response: zExpeditionQuoteResponse,
    })
    return quote.projected_balance === expectedMaterialsBalance
  } catch {
    return false
  }
}
