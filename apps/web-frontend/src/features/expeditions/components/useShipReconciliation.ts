import { useEffect, useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { shipQueryKey, type ShipState } from '@/features/ship'

export type ShipReconciliationPhase = 'idle' | 'updating' | 'delayed'

/**
 * Bounded downstream reconciliation of a Ship balance change (§3.4,
 * web-frontend.md): probes the authoritative Ship query at approximately 1, 2,
 * 4, and 8 seconds while the page is visible and online, stops as soon as
 * `expectedBalance` is observed, and expires into a local `delayed` state with
 * a player-initiated retry. Never replays a command.
 */
export function useShipReconciliation({
  enabled,
  expectedBalance,
}: {
  enabled: boolean
  expectedBalance: number | undefined
}): { phase: ShipReconciliationPhase; retry: () => void } {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<ShipReconciliationPhase>('idle')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled || expectedBalance === undefined) {
      return
    }
    let cancelled = false

    const run = async (): Promise<void> => {
      setPhase('updating')
      for (const delay of [1_000, 2_000, 4_000, 8_000]) {
        await sleep(delay)
        if (cancelled) {
          return
        }
        // Pause reconciliation while the tab is hidden or the player offline.
        if (document.visibilityState !== 'visible' || !navigator.onLine) {
          continue
        }
        await queryClient.invalidateQueries({ queryKey: shipQueryKey })
        await queryClient.refetchQueries({ queryKey: shipQueryKey })
        const ship = queryClient.getQueryData<ShipState>(shipQueryKey)
        if (ship?.kind === 'ready' && ship.ship.materials_balance >= expectedBalance) {
          setPhase('idle')
          return
        }
      }
      setPhase('delayed')
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [enabled, expectedBalance, attempt, queryClient])

  const effectivePhase: ShipReconciliationPhase =
    enabled && expectedBalance !== undefined ? phase : 'idle'

  return {
    phase: effectivePhase,
    retry: () => {
      setAttempt((value) => value + 1)
    },
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs)
  })
}
