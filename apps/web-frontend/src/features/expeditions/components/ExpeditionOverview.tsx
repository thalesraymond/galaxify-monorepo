import { useEffect, useRef, useState } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { getShip, shipQueryKey } from '@/features/ship'
import { useApiTransport } from '@/shared/api/TransportContext'
import { useDownstreamObservation } from '@/shared/reconciliation'
import { Skeleton, UnavailableState } from '@/shared/ui'

import {
  currentExpeditionQueryKey,
  getCurrentExpedition,
  type CurrentExpedition,
  type Expedition,
} from '../api/expeditionApi'
import { launchDeductionKey } from '../lib/launchDeductionObservation'
import { registerExpeditionReward } from '../lib/expeditionRewardObservation'
import { PendingExpeditionRewards } from './ExpeditionRewardSync'
import { ExpeditionProgress } from './ExpeditionProgress'
import { LaunchForm } from './LaunchForm'
import { type MaterialsSync } from './MaterialsBalance'
import { boundedResolvePollMs } from './polling'
import { PreparingPanel, ResultPanel } from './ResultPanel'
import { StaleNotice } from './StaleNotice'
import styles from './overview.module.css'

/** Bounded current-Expedition poll: stops once there is no in-flight Expedition. */
function currentPollInterval(data: CurrentExpedition | undefined): number | false {
  if (data?.kind !== 'current' || data.expedition.status !== 'IN_FLIGHT') {
    return false
  }
  return boundedResolvePollMs(data.expedition.resolve_at)
}

/**
 * `/expeditions` — mutually exclusive launch vs in-flight state driven by the
 * authoritative current Expedition, with bounded Ship reconciliation on launch
 * and at resolution (§5.6, §3.4) and stale-refresh labeling (§3.2).
 */
export function ExpeditionOverview() {
  const transport = useApiTransport()
  const queryClient = useQueryClient()
  const currentQuery = useQuery({
    queryKey: currentExpeditionQueryKey,
    queryFn: ({ signal }) => getCurrentExpedition(transport, signal),
    refetchInterval: (query) => currentPollInterval(query.state.data),
  })
  const shipQuery = useQuery({
    queryKey: shipQueryKey,
    queryFn: ({ signal }) => getShip(transport, signal),
  })
  const balance =
    shipQuery.data?.kind === 'ready' ? shipQuery.data.ship.materials_balance : undefined

  // A transition from an in-flight current Expedition to typed `none` while
  // mounted means the Expedition resolved in this page session: keep the
  // last-known in-flight record so the result is shown (and celebrated) once.
  const [resolved, setResolved] = useState<Expedition | undefined>(undefined)
  const prevCurrentRef = useRef<CurrentExpedition | undefined>(undefined)

  useEffect(() => {
    const data = currentQuery.data
    const prev = prevCurrentRef.current
    prevCurrentRef.current = data
    if (
      prev?.kind === 'current' &&
      prev.expedition.status === 'IN_FLIGHT' &&
      data?.kind === 'none'
    ) {
      setResolved(prev.expedition)
    }
  }, [currentQuery.data, shipQuery.data])

  useEffect(() => {
    if (currentQuery.data?.kind === 'current') {
      registerExpeditionReward(currentQuery.data.expedition, queryClient, transport)
    }
  }, [currentQuery.data, queryClient, transport])

  const currentStale = currentQuery.isRefetchError

  // Bounded Ship deduction reconciliation after a launch (§3.4).
  const inFlight =
    currentQuery.data?.kind === 'current' && currentQuery.data.expedition.status === 'IN_FLIGHT'
  const expeditionId = currentQuery.data?.kind === 'current' ? currentQuery.data.expedition.id : ''
  const deductionProbe = useDownstreamObservation(launchDeductionKey(expeditionId), inFlight)
  const deductionSync: MaterialsSync = {
    balance,
    phase: deductionProbe.phase,
    onRetry: deductionProbe.retry,
  }

  if (currentQuery.isPending) {
    return <Skeleton lines={4} />
  }
  if (currentQuery.isError && currentQuery.data === undefined) {
    return (
      <UnavailableState
        title="Expeditions are unavailable"
        description="We could not check your Expedition. Try again."
        onRetry={() => {
          void currentQuery.refetch()
        }}
      />
    )
  }

  const current = currentQuery.data
  if (current.kind === 'not_ready') {
    return (
      <PreparingPanel
        onRetry={() => {
          void currentQuery.refetch()
        }}
      />
    )
  }
  if (current.kind === 'current') {
    if (current.expedition.status === 'IN_FLIGHT') {
      return (
        <div className={styles.overview}>
          {currentStale ? (
            <StaleNotice
              onRetry={() => {
                void currentQuery.refetch()
              }}
            />
          ) : null}
          <ExpeditionProgress
            expedition={current.expedition}
            showLinks
            balanceSync={deductionSync}
          />
          <PendingExpeditionRewards />
        </div>
      )
    }
    // Defensive: an authoritative current Expedition that is already resolved
    // shows its result without replaying a celebration.
    return (
      <>
        <ResultPanel
          expeditionId={current.expedition.id}
          celebrate={false}
          showRewardSync={false}
        />
        <PendingExpeditionRewards />
      </>
    )
  }

  // No Expedition is current.
  return (
    <div className={styles.overview}>
      {currentStale ? (
        <StaleNotice
          onRetry={() => {
            void currentQuery.refetch()
          }}
        />
      ) : null}
      {resolved !== undefined ? <ResultPanel expeditionId={resolved.id} celebrate /> : null}
      <PendingExpeditionRewards excludeId={resolved?.id} />
      <LaunchForm balance={balance} />
    </div>
  )
}
