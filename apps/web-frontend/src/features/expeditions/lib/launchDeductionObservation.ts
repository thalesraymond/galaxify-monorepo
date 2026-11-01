import type { QueryClient } from '@tanstack/react-query'

import type { ApiTransport } from '@/api/transport'
import { observeShip, shipQueryKey } from '@/features/ship'
import {
  onClearDownstreamObservations,
  registerDownstreamObservation,
} from '@/shared/reconciliation'

import type { Expedition } from '../api/expeditionApi'

type LaunchDeduction = {
  readonly expeditionId: string
  readonly invested: number
  readonly baseline: number | undefined
  readonly expectedBalance: number | undefined
}

const expectations = new Map<string, LaunchDeduction>()
let sessionGeneration = 0

export function launchDeductionSessionGeneration(): number {
  return sessionGeneration
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
  const key = launchDeductionKey(expedition.id)
  if (expectations.has(key)) return
  const expectation: LaunchDeduction = {
    expeditionId: expedition.id,
    invested: expedition.materials_invested,
    baseline,
    expectedBalance: baseline === undefined ? undefined : baseline - expedition.materials_invested,
  }
  expectations.set(key, expectation)
  registerDownstreamObservation({
    key,
    read: (signal) => observeShip(queryClient, transport, signal),
    publish: (ship) => queryClient.setQueryData(shipQueryKey, ship),
    isSatisfied: (ship) =>
      expectation.expectedBalance !== undefined &&
      ship.kind === 'ready' &&
      ship.ship.materials_balance <= expectation.expectedBalance,
  })
}

onClearDownstreamObservations(() => {
  expectations.clear()
  sessionGeneration += 1
})
