import type { QueryClient } from '@tanstack/react-query'

import type { ApiTransport } from '@/api/transport'
import { observeShip, shipQueryKey, type ShipState } from '@/features/ship'
import {
  downstreamReconciliation,
  registerDownstreamObservation,
  useDownstreamExpectations,
  type DownstreamExpectation,
} from '@/shared/reconciliation'

import type { Expedition } from '../api/expeditionApi'

export const EXPEDITION_REWARD_SCOPE = 'expedition:reward'

type RewardMeta = {
  readonly expeditionId: string
  readonly baseline: number | undefined
  readonly expectedBalance: number | undefined
  readonly reward: number
}

export type RewardExpectation = DownstreamExpectation<RewardMeta>

export function expeditionRewardKey(expeditionId: string): string {
  return `expedition:${expeditionId}:reward`
}

export function subscribeToExpeditionRewards(listener: () => void): () => void {
  return downstreamReconciliation.subscribeExpectations(EXPEDITION_REWARD_SCOPE, listener)
}

export function getExpeditionRewards(): ReadonlyMap<string, RewardExpectation> {
  return downstreamReconciliation.getExpectations<RewardMeta>(EXPEDITION_REWARD_SCOPE)
}

export function useExpeditionRewards(): ReadonlyMap<string, RewardExpectation> {
  return useDownstreamExpectations<RewardMeta>(EXPEDITION_REWARD_SCOPE)
}

export function registerExpeditionReward(
  expedition: Expedition,
  queryClient: QueryClient,
  transport: ApiTransport,
): void {
  const result = expedition.result
  if (expedition.status === 'IN_FLIGHT' || result === undefined) {
    return
  }
  const ship = queryClient.getQueryData<ShipState>(shipQueryKey)
  const baseline =
    ship?.kind === 'ready' && Date.parse(ship.ship.updated_at) < Date.parse(result.created_at)
      ? ship.ship.materials_balance
      : undefined
  const reward = result.material_reward.materials
  const expectedBalance = baseline === undefined ? undefined : baseline + reward

  registerDownstreamObservation<ShipState, RewardMeta>({
    key: expeditionRewardKey(expedition.id),
    id: expedition.id,
    scope: EXPEDITION_REWARD_SCOPE,
    onConflict: 'once-per-session',
    meta: {
      expeditionId: expedition.id,
      baseline,
      expectedBalance,
      reward,
    },
    read: (signal) => observeShip(queryClient, transport, signal),
    publish: (fresh) => {
      queryClient.setQueryData(shipQueryKey, fresh)
    },
    isSatisfied: (fresh, meta) =>
      meta.expectedBalance !== undefined &&
      fresh.kind === 'ready' &&
      (meta.reward < 0
        ? fresh.ship.materials_balance <= meta.expectedBalance
        : fresh.ship.materials_balance >= meta.expectedBalance),
  })
}
