import type { QueryClient } from '@tanstack/react-query'

import type { ApiTransport } from '@/api/transport'
import { expeditionQuoteQueryKeyFor, getExpeditionQuote } from '@/features/expeditions'
import {
  downstreamReconciliation,
  registerDownstreamObservation,
  useDownstreamObservation,
} from '@/shared/reconciliation'

import { observeShip } from '../api/shipQueries'

const REPAIR_READINESS_KEY = 'ship:repair:readiness'
const PROBE_INVESTMENT = 1

/** The expectation belongs to the session; the visible panel only observes it. */
export function useShipRepairReconciliation(queryClient: QueryClient, transport: ApiTransport) {
  const { phase, retry } = useDownstreamObservation(REPAIR_READINESS_KEY, true)

  const beginReconciliation = (): void => {
    if (downstreamReconciliation.getPhase(REPAIR_READINESS_KEY) !== 'idle') {
      downstreamReconciliation.retry(REPAIR_READINESS_KEY)
      return
    }
    registerDownstreamObservation({
      key: REPAIR_READINESS_KEY,
      read: async (signal) => {
        const [ship, quote] = await Promise.allSettled([
          observeShip(queryClient, transport, signal),
          getExpeditionQuote(transport, PROBE_INVESTMENT, signal),
        ])
        return { ship, quote }
      },
      isSatisfied: ({ ship, quote }) =>
        ship.status === 'fulfilled' &&
        quote.status === 'fulfilled' &&
        ship.value.kind === 'ready' &&
        quote.value.projected_balance + quote.value.materials_invested ===
          ship.value.ship.materials_balance,
      publish: ({ quote }) => {
        if (quote.status === 'fulfilled') {
          queryClient.setQueryData(expeditionQuoteQueryKeyFor(PROBE_INVESTMENT), quote.value)
        }
      },
    })
  }

  return { reconciliation: { kind: phase }, beginReconciliation, retryReconciliation: retry }
}
