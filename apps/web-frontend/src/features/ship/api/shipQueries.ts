import type { QueryClient } from '@tanstack/react-query'

import type { ApiTransport } from '@/api/transport'
import { getDownstreamSessionGeneration } from '@/shared/reconciliation'

import {
  getShip,
  getShipCommandRevision,
  getShipFetchMark,
  markShipPublished,
  repairShip,
  shipQueryKey,
  type ShipState,
} from './shipApi'

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
export async function observeShip(
  queryClient: QueryClient,
  transport: ApiTransport,
  signal?: AbortSignal,
): Promise<ShipState> {
  // A negative stale time is always stale, even when data was written in the
  // same millisecond, so an observation always reaches the server.
  const before = getShipFetchMark().generation
  const commandRevision = getShipCommandRevision()
  const data = await queryClient.query({
    queryKey: shipQueryKey,
    queryFn: async ({ signal: querySignal }) => {
      const state = await getShip(transport, composeSignals(signal, querySignal))
      if (getShipCommandRevision() !== commandRevision) {
        throw new Error('Ship read was superseded by a command publish.')
      }
      return state
    },
    staleTime: -1,
    retry: false,
  })
  // A cancelled fetch with revert returns the retained cache state instead of
  // rejecting. A real fetch advances the marker; if a newer read with different
  // facts landed first, this result must not overwrite it. TanStack structural
  // sharing may store an equal, but not identical, object.
  // A joined read does not execute this call's queryFn, so re-check the
  // command revision before returning; a command publish always wins.
  if (getShipCommandRevision() !== commandRevision) {
    throw new Error('Ship read was superseded by a command publish.')
  }
  const after = getShipFetchMark()
  if (after.generation === before || JSON.stringify(after.state) !== JSON.stringify(data)) {
    throw new Error('Ship read did not produce a fresh authoritative result.')
  }
  return data
}

/** Publish only the confirmed repair, preventing an older read from undoing it. */
export async function repairShipAndCache(
  queryClient: QueryClient,
  transport: ApiTransport,
  generation = getDownstreamSessionGeneration(),
) {
  const ship = await repairShip(transport)
  if (generation !== getDownstreamSessionGeneration()) return ship
  await queryClient.cancelQueries({ queryKey: shipQueryKey, exact: true })
  if (generation !== getDownstreamSessionGeneration()) return ship
  const published = { kind: 'ready', ship } satisfies ShipState
  queryClient.setQueryData(shipQueryKey, published)
  markShipPublished(published)
  return ship
}
