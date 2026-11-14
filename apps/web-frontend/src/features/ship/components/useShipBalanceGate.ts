import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useApiTransport } from '@/shared/api/TransportContext'
import { useBalanceGate, type BalanceGateState } from '@/shared/reconciliation'

import { getShip, shipQueryKey } from '../api/shipApi'
import { observeShip } from '../api/shipQueries'

export type ShipBalanceGateState = BalanceGateState

export type ShipBalanceGate = {
  readonly state: ShipBalanceGateState
  readonly reason: string
  readonly balance: number | undefined
  readonly retry: () => void
}

const GATE_REASONS: Record<ShipBalanceGateState, string> = {
  updating: 'The Ship balance is updating after a Daily completion.',
  stale: 'The Ship balance could not be refreshed. Retry before using it.',
  refreshing: 'Checking the current Ship balance.',
  open: '',
}

/**
 * Closes balance-spending actions (`Ship Repair` and `Expedition Launch`)
 * while a balance-affecting Daily observation is in flight, or until a fresh
 * authoritative Ship read confirms the balance after an observation expires.
 */
export function useShipBalanceGate(): ShipBalanceGate {
  const transport = useApiTransport()
  const queryClient = useQueryClient()
  const ship = useQuery({
    queryKey: shipQueryKey,
    queryFn: ({ signal }) => getShip(transport, signal),
    enabled: false,
  })

  const read = useCallback(
    async (signal: AbortSignal): Promise<boolean> =>
      (await observeShip(queryClient, transport, signal)).kind === 'ready',
    [queryClient, transport],
  )

  const gate = useBalanceGate({
    read,
    confirmedAt:
      ship.status === 'success' && ship.data.kind === 'ready' ? ship.dataUpdatedAt : undefined,
    hasRefreshError: ship.status === 'error',
  })

  const balance = ship.data?.kind === 'ready' ? ship.data.ship.materials_balance : undefined

  return {
    state: gate.state,
    reason: GATE_REASONS[gate.state],
    balance,
    retry: gate.retry,
  }
}
