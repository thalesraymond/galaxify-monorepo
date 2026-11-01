import { useEffect } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { useApiTransport } from '@/shared/api/TransportContext'
import {
  registerDownstreamObservation,
  useDownstreamObservation,
  type DownstreamObservationView,
} from '@/shared/reconciliation'

import {
  expeditionDetailQueryKeyFor,
  getExpeditionById,
  type Expedition,
} from '../api/expeditionApi'

/**
 * One expected change per Expedition: its typed result never changes identity,
 * so route changes and local Retry reuse the same pending observation.
 */
export function expeditionResultObservationKey(expeditionId: string): string {
  return `expedition:${expeditionId}:result`
}

/**
 * A resolved status without a typed result means the result is still
 * propagating (`web-frontend.md` §5.6/§5.7); an in-flight Expedition is
 * ordinary polling, never bounded observation.
 */
export function isExpeditionResultMissing(expedition: Expedition | undefined): boolean {
  return (
    expedition !== undefined && expedition.status !== 'IN_FLIGHT' && expedition.result === undefined
  )
}

/**
 * Observes a resolved Expedition's expected typed result through the shared
 * Downstream Reconciliation module. Fresh successful reads publish the
 * authoritative Expedition into its shared detail query (the same key every
 * view reads), so the fact becomes visible wherever the Player looks; retained
 * data from a failed refresh never counts as fresh confirmation.
 */
export function useExpeditionResultReconciliation(
  expeditionId: string,
  expedition: Expedition | undefined,
): DownstreamObservationView {
  const transport = useApiTransport()
  const queryClient = useQueryClient()
  const missing = isExpeditionResultMissing(expedition)

  useEffect(() => {
    if (!missing) {
      return
    }
    registerDownstreamObservation({
      key: expeditionResultObservationKey(expeditionId),
      read: (signal) => getExpeditionById(transport, expeditionId, signal),
      isSatisfied: (fresh) =>
        fresh.result !== undefined ||
        queryClient.getQueryData<Expedition>(expeditionDetailQueryKeyFor(expeditionId))?.result !==
          undefined,
      publish: (fresh) => {
        queryClient.setQueryData<Expedition>(expeditionDetailQueryKeyFor(expeditionId), (current) =>
          // A typed result is immutable: a slower observation must not erase
          // the result already confirmed by another successful detail read.
          current?.result !== undefined ? current : fresh,
        )
      },
    })
  }, [missing, expeditionId, transport, queryClient])

  return useDownstreamObservation(expeditionResultObservationKey(expeditionId), missing)
}
