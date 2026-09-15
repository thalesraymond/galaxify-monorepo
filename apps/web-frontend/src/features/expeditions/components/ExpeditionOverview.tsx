import { useEffect, useRef, useState } from 'react'

import { useQuery } from '@tanstack/react-query'

import { getShip, shipQueryKey } from '@/features/ship'
import { useApiTransport } from '@/shared/api/TransportContext'
import { Skeleton, UnavailableState } from '@/shared/ui'

import {
  currentExpeditionQueryKey,
  expeditionDetailQueryKeyFor,
  getCurrentExpedition,
  getExpeditionById,
  type CurrentExpedition,
  type Expedition,
} from '../api/expeditionApi'
import { ExpeditionProgress } from './ExpeditionProgress'
import { LaunchForm } from './LaunchForm'
import { MaterialsBalance, type MaterialsSync } from './MaterialsBalance'
import { boundedResolvePollMs } from './polling'
import { PreparingPanel, ResultPanel } from './ResultPanel'
import { StaleNotice } from './StaleNotice'
import { useShipReconciliation } from './useShipReconciliation'
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
  const [resolved, setResolved] = useState<
    { readonly base: Expedition; readonly balanceAtResolution: number | undefined } | undefined
  >(undefined)
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
      setResolved({
        base: prev.expedition,
        balanceAtResolution:
          shipQuery.data?.kind === 'ready' ? shipQuery.data.ship.materials_balance : undefined,
      })
    }
  }, [currentQuery.data, shipQuery.data])

  const currentStale = currentQuery.isRefetchError

  // Bounded Ship deduction reconciliation after a launch (§3.4).
  const [deduction, setDeduction] = useState<{ expectedBalance: number | undefined } | undefined>(
    undefined,
  )
  const deductionProbe = useShipReconciliation({
    enabled: deduction !== undefined,
    expectedBalance: deduction?.expectedBalance,
    direction: 'decrease',
  })
  const deductionSync: MaterialsSync = {
    balance,
    phase: deductionProbe.phase,
    onRetry: deductionProbe.retry,
  }

  function handleLaunched(expedition: Expedition): void {
    const balanceNow =
      shipQuery.data?.kind === 'ready' ? shipQuery.data.ship.materials_balance : undefined
    setDeduction({
      expectedBalance:
        balanceNow === undefined ? undefined : balanceNow - expedition.materials_invested,
    })
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
        </div>
      )
    }
    // Defensive: an authoritative current Expedition that is already resolved
    // shows its result without replaying a celebration.
    return <ResultPanel expeditionId={current.expedition.id} celebrate={false} />
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
      {resolved !== undefined ? (
        <ResolvedMission
          balance={balance}
          base={resolved.base}
          balanceAtResolution={resolved.balanceAtResolution}
        />
      ) : null}
      <LaunchForm balance={balance} onLaunched={handleLaunched} />
    </div>
  )
}

/**
 * Result + bounded Ship reward reconciliation for an Expedition that resolved
 * while this overview was mounted. The detail query shares the cache with
 * `ResultPanel`, so only one request is issued.
 */
function ResolvedMission({
  base,
  balanceAtResolution,
  balance,
}: {
  base: Expedition
  balanceAtResolution: number | undefined
  balance: number | undefined
}) {
  const transport = useApiTransport()
  const detail = useQuery({
    queryKey: expeditionDetailQueryKeyFor(base.id),
    queryFn: ({ signal }) => getExpeditionById(transport, base.id, signal),
  })
  const rewardExpected =
    balanceAtResolution !== undefined && detail.data?.result !== undefined
      ? balanceAtResolution + detail.data.result.material_reward.materials
      : undefined
  const rewardProbe = useShipReconciliation({
    enabled: rewardExpected !== undefined,
    expectedBalance: rewardExpected,
    direction: 'increase',
  })
  const rewardSync: MaterialsSync = {
    balance,
    phase: rewardProbe.phase,
    onRetry: rewardProbe.retry,
  }
  return (
    <>
      <ResultPanel expeditionId={base.id} celebrate />
      <MaterialsBalance sync={rewardSync} />
    </>
  )
}
