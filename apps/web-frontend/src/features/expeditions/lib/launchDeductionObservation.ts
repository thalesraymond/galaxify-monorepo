import type { QueryClient } from '@tanstack/react-query'

import type { ApiTransport } from '@/api/transport'
import { observeShip, shipQueryKey, type ShipState } from '@/features/ship'
import { registerDownstreamObservation } from '@/shared/reconciliation'

import type { Expedition } from '../api/expeditionApi'

type LaunchDeduction = {
  readonly baseline: number | undefined
  readonly expectedBalance: number | undefined
}

export function launchDeductionKey(expeditionId: string): string {
  return `expedition:${expeditionId}:launch-deduction`
}

export function registerLaunchDeduction(
  expedition: Expedition,
  baseline: number | undefined,
  queryClient: QueryClient,
  transport: ApiTransport,
): void {
  registerDownstreamObservation<ShipState, LaunchDeduction>({
    key: launchDeductionKey(expedition.id),
    onConflict: 'once-per-session',
    meta: {
      baseline,
      expectedBalance:
        baseline === undefined ? undefined : baseline - expedition.materials_invested,
    },
    read: (signal) => observeShip(queryClient, transport, signal),
    publish: (ship) => {
      queryClient.setQueryData(shipQueryKey, ship)
    },
    isSatisfied: (ship, meta) =>
      meta.expectedBalance !== undefined &&
      ship.kind === 'ready' &&
      ship.ship.materials_balance <= meta.expectedBalance,
  })
}
