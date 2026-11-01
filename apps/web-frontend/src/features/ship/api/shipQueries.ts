import type { QueryClient } from '@tanstack/react-query'

import type { ApiTransport } from '@/api/transport'

import { getShip, repairShip, shipQueryKey, type ShipState } from './shipApi'

/**
 * Composes the caller's abort signal with the query's own signal: a bounded
 * observation that is cancelled must stop its read even while the query stays
 * cached. Either signal aborting aborts the composed one.
 */
function composeSignals(caller: AbortSignal | undefined, query: AbortSignal): AbortSignal {
  if (caller === undefined) {
    return query
  }
  const controller = new AbortController()
  const abort = (): void => {
    controller.abort()
  }
  if (caller.aborted || query.aborted) {
    abort()
    return controller.signal
  }
  caller.addEventListener('abort', abort, { once: true })
  query.addEventListener('abort', abort, { once: true })
  return controller.signal
}

/**
 * A reconciliation observation must reach the server even inside the normal
 * freshness window. QueryClient owns cache publication and in-flight sharing;
 * the caller's bounded schedule owns retries, not an additional query loop.
 *
 * The optional `signal` lets the caller's bounded schedule abandon a fresh
 * read (session boundary, superseded round, timeout) instead of letting it
 * publish facts after the round is gone.
 */
export function observeShip(
  queryClient: QueryClient,
  transport: ApiTransport,
  signal?: AbortSignal,
): Promise<ShipState> {
  return queryClient.query({
    queryKey: shipQueryKey,
    queryFn: ({ signal: querySignal }) => getShip(transport, composeSignals(signal, querySignal)),
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
