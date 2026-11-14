import { useQuery } from '@tanstack/react-query'

import { getShip, shipQueryKey } from '@/features/ship'
import { useApiTransport } from '@/shared/api/TransportContext'
import { useDownstreamObservation } from '@/shared/reconciliation'

import { currentExpeditionQueryKey, getCurrentExpedition } from '../api/expeditionApi'
import { launchDeductionKey } from '../lib/launchDeductionObservation'
import { MaterialsBalance } from './MaterialsBalance'

// Bounded Ship deduction reconciliation after a launch (§3.4).
export function LaunchDeductionSync() {
  const transport = useApiTransport()
  const current = useQuery({
    queryKey: currentExpeditionQueryKey,
    queryFn: ({ signal }) => getCurrentExpedition(transport, signal),
  }).data
  const ship = useQuery({
    queryKey: shipQueryKey,
    queryFn: ({ signal }) => getShip(transport, signal),
    enabled: false,
  }).data
  const inFlight = current?.kind === 'current' && current.expedition.status === 'IN_FLIGHT'
  const expeditionId = current?.kind === 'current' ? current.expedition.id : ''
  const observation = useDownstreamObservation(launchDeductionKey(expeditionId), inFlight)
  if (!inFlight) {
    return null
  }
  return (
    <MaterialsBalance
      sync={{
        balance: ship?.kind === 'ready' ? ship.ship.materials_balance : undefined,
        phase: observation.phase,
        onRetry: observation.retry,
      }}
    />
  )
}
