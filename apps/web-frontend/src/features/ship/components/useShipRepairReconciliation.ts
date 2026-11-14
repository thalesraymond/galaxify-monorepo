import type { QueryClient } from '@tanstack/react-query'

import type { ApiTransport } from '@/api/transport'
import { expeditionQuoteQueryKeyFor, getExpeditionQuote } from '@/features/expeditions'
import { registerDownstreamObservation, useDownstreamObservation } from '@/shared/reconciliation'

import { observeShip } from '../api/shipQueries'

const REPAIR_READINESS_KEY = 'ship:repair:readiness'
const READINESS_INVESTMENT = 1

/** The expectation belongs to the session; the visible panel only observes it. */
export function useShipRepairReconciliation(queryClient: QueryClient, transport: ApiTransport) {
  const { phase, retry } = useDownstreamObservation(REPAIR_READINESS_KEY, true)

  const beginReconciliation = (): void => {
    registerDownstreamObservation({
      key: REPAIR_READINESS_KEY,
      onConflict: 'restart',
      read: async (signal) => {
        const [ship, quote] = await Promise.allSettled([
          observeShip(queryClient, transport, signal),
          getExpeditionQuote(transport, READINESS_INVESTMENT, signal),
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
          queryClient.setQueryData(expeditionQuoteQueryKeyFor(READINESS_INVESTMENT), quote.value)
        }
      },
    })
  }

  return { reconciliation: { kind: phase }, beginReconciliation, retryReconciliation: retry }
}
