import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'

import { getShip, shipQueryKey } from '@/features/ship'
import { useApiTransport } from '@/shared/api/TransportContext'
import { useDownstreamObservation } from '@/shared/reconciliation'

import {
  expeditionRewardKey,
  getExpeditionRewards,
  subscribeToExpeditionRewards,
} from '../lib/expeditionRewardObservation'
import { MaterialsBalance } from './MaterialsBalance'

export function ExpeditionRewardSync({ expeditionId }: { expeditionId: string }) {
  const transport = useApiTransport()
  const ship = useQuery({
    queryKey: shipQueryKey,
    queryFn: ({ signal }) => getShip(transport, signal),
    enabled: false,
  }).data
  const expectations = useSyncExternalStore(
    subscribeToExpeditionRewards,
    getExpeditionRewards,
    getExpeditionRewards,
  )
  const expectation = expectations.get(expeditionId)
  const observation = useDownstreamObservation(
    expeditionRewardKey(expeditionId),
    expectation !== undefined && expectation.phase !== 'idle',
  )
  if (expectation === undefined) return null
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

export function PendingExpeditionRewards({ excludeId }: { excludeId?: string | undefined }) {
  const expectations = useSyncExternalStore(
    subscribeToExpeditionRewards,
    getExpeditionRewards,
    getExpeditionRewards,
  )
  return [...expectations.values()]
    .filter((expectation) => expectation.phase !== 'idle' && expectation.expeditionId !== excludeId)
    .map((expectation) => (
      <ExpeditionRewardSync
        key={expectation.expeditionId}
        expeditionId={expectation.expeditionId}
      />
    ))
}
