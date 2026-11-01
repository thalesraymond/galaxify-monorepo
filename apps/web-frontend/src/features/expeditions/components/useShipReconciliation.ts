import { useQueryClient } from '@tanstack/react-query'

import { observeShip } from '@/features/ship'
import { useApiTransport } from '@/shared/api/TransportContext'

import { useBoundedProbe, type BoundedProbePhase } from './useProbeSchedule'

export type ShipReconciliationPhase = BoundedProbePhase

/**
 * Resolution reward reconciliation remains on the local §3.4 probe schedule:
 * immediate then ≈1/2/4/8s cumulative, pausing while the tab is hidden or
 * offline, stopping only when the authoritative balance reflects the expected
 * reward, and expiring into `Update delayed` with a local
 * Retry (§3.4, §3.2).
 */
export function useShipReconciliation({
  enabled,
  expectedBalance,
}: {
  enabled: boolean
  expectedBalance: number | undefined
}): { phase: ShipReconciliationPhase; retry: () => void } {
  const queryClient = useQueryClient()
  const transport = useApiTransport()

  return useBoundedProbe({
    enabled: enabled && expectedBalance !== undefined,
    probe: async () => {
      const ship = await observeShip(queryClient, transport)
      if (ship.kind !== 'ready' || expectedBalance === undefined) {
        return false
      }
      return ship.ship.materials_balance >= expectedBalance
    },
  })
}
