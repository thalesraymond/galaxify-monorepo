import { useQueryClient } from '@tanstack/react-query'

import { observeShip } from '@/features/ship'
import { useApiTransport } from '@/shared/api/TransportContext'

import { useBoundedProbe, type BoundedProbePhase } from './useProbeSchedule'

export type ShipReconciliationPhase = BoundedProbePhase

/**
 * Which direction the authoritative balance must move for the expected change
 * to count as observed: `decrease` for a launch deduction, `increase` for a
 * resolution reward.
 */
export type ShipReconciliationDirection = 'decrease' | 'increase'

/**
 * Bounded Ship balance reconciliation through the shared §3.4 probe schedule:
 * immediate then ≈1/2/4/8s cumulative, pausing while the tab is hidden or
 * offline, stopping only when the authoritative balance reflects the expected
 * change (a deduction drops to the post-launch balance; a reward rises to the
 * post-resolution balance), and expiring into `Update delayed` with a local
 * Retry (§3.4, §3.2).
 */
export function useShipReconciliation({
  enabled,
  expectedBalance,
  direction,
}: {
  enabled: boolean
  expectedBalance: number | undefined
  direction: ShipReconciliationDirection
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
      return direction === 'decrease'
        ? ship.ship.materials_balance <= expectedBalance
        : ship.ship.materials_balance >= expectedBalance
    },
  })
}
