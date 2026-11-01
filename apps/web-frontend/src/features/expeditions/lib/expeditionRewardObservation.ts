import type { QueryClient } from '@tanstack/react-query'

import type { ApiTransport } from '@/api/transport'
import { observeShip, shipQueryKey, type ShipState } from '@/features/ship'
import {
  downstreamReconciliation,
  onClearDownstreamObservations,
  registerDownstreamObservation,
  type DownstreamObservationPhase,
} from '@/shared/reconciliation'

import type { Expedition } from '../api/expeditionApi'

type RewardExpectation = {
  readonly expeditionId: string
  readonly resultId: string
  readonly reward: number
  readonly baseline: number | undefined
  readonly expectedBalance: number | undefined
  readonly phase: DownstreamObservationPhase
}

const expectations = new Map<string, RewardExpectation>()
const phaseSubscriptions = new Map<string, () => void>()
const listeners = new Set<() => void>()
let snapshot: ReadonlyMap<string, RewardExpectation> = new Map()

export function expeditionRewardKey(expeditionId: string): string {
  return `expedition:${expeditionId}:reward`
}

function publishSnapshot(): void {
  snapshot = new Map(expectations)
  for (const listener of listeners) listener()
}

export function subscribeToExpeditionRewards(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getExpeditionRewards(): ReadonlyMap<string, RewardExpectation> {
  return snapshot
}

export function registerExpeditionReward(
  expedition: Expedition,
  queryClient: QueryClient,
  transport: ApiTransport,
): void {
  const result = expedition.result
  if (expedition.status === 'IN_FLIGHT' || result === undefined || expectations.has(expedition.id))
    return
  const ship = queryClient.getQueryData<ShipState>(shipQueryKey)
  const baseline =
    ship?.kind === 'ready' && Date.parse(ship.ship.updated_at) < Date.parse(result.created_at)
      ? ship.ship.materials_balance
      : undefined
  const reward = result.material_reward.materials
  const expectedBalance = baseline === undefined ? undefined : baseline + reward
  const key = expeditionRewardKey(expedition.id)
  expectations.set(expedition.id, {
    expeditionId: expedition.id,
    resultId: result.id,
    reward,
    baseline,
    expectedBalance,
    phase: 'updating',
  })
  phaseSubscriptions.set(
    expedition.id,
    downstreamReconciliation.subscribeToPhase(key, () => {
      const current = expectations.get(expedition.id)
      if (current === undefined) return
      expectations.set(expedition.id, { ...current, phase: downstreamReconciliation.getPhase(key) })
      publishSnapshot()
    }),
  )
  publishSnapshot()
  registerDownstreamObservation({
    key,
    read: (signal) => observeShip(queryClient, transport, signal),
    publish: (fresh) => queryClient.setQueryData(shipQueryKey, fresh),
    isSatisfied: (fresh) =>
      expectedBalance !== undefined &&
      fresh.kind === 'ready' &&
      (reward < 0
        ? fresh.ship.materials_balance <= expectedBalance
        : fresh.ship.materials_balance >= expectedBalance),
  })
}

onClearDownstreamObservations(() => {
  for (const unsubscribe of phaseSubscriptions.values()) unsubscribe()
  phaseSubscriptions.clear()
  expectations.clear()
  publishSnapshot()
})
