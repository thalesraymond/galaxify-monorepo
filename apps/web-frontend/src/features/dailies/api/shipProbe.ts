import { zShipGetMeResponse } from '@/api/generated/ship/zod.gen'
import type { ApiTransport } from '@/api/transport'

/**
 * The Dailies feature reconciles the Ship after Daily completion
 * (web-frontend.md §3.4). It invalidates the Ship balance query and probes the
 * balance through the shared transport so the feature boundary never
 * deep-imports the Ship feature.
 *
 * The key literal mirrors the Ship feature's `shipQueryKey`; the Ship feature
 * does not yet expose it through its public entry point.
 */
export const SHIP_BALANCE_QUERY_KEY = ['ship'] as const

export async function probeShipBalance(
  transport: ApiTransport,
  signal?: AbortSignal,
): Promise<number> {
  const ship = await transport.request({
    service: 'ship',
    path: '/ships/me',
    response: zShipGetMeResponse,
    signal,
  })
  return ship.materials_balance
}
