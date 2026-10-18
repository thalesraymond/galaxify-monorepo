import type { QueryClient } from '@tanstack/react-query'

import type { ApiTransport } from '@/api/transport'

import { getShip, repairShip, shipQueryKey, type ShipState } from './shipApi'

/**
 * A reconciliation observation must reach the server even inside the normal
 * freshness window. QueryClient owns cache publication and in-flight sharing;
 * the caller's bounded schedule owns retries, not an additional query loop.
 */
export function observeShip(queryClient: QueryClient, transport: ApiTransport): Promise<ShipState> {
  return queryClient.query({
    queryKey: shipQueryKey,
    queryFn: ({ signal }) => getShip(transport, signal),
    staleTime: 0,
    retry: false,
  })
}

/** Publish only the confirmed repair, preventing an older read from undoing it. */
export async function repairShipAndCache(queryClient: QueryClient, transport: ApiTransport) {
  const ship = await repairShip(transport)
  await queryClient.cancelQueries({ queryKey: shipQueryKey, exact: true })
  queryClient.setQueryData(shipQueryKey, { kind: 'ready', ship } satisfies ShipState)
  return ship
}
