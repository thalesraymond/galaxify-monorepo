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
import { PreparingPanel, ResultPanel } from './ResultPanel'
import { useShipReconciliation } from './useShipReconciliation'
import styles from './overview.module.css'

const NO_DETAIL_QUERY_KEY = ['expeditions', 'detail', 'none'] as const

/**
 * Bounded current-Expedition poll derived from `resolve_at`: it never polls
 * when there is no in-flight Expedition, and it tightens near resolution.
 */
function currentPollInterval(data: CurrentExpedition | undefined): number | false {
  if (data?.kind !== 'current' || data.expedition.status !== 'IN_FLIGHT') {
    return false
  }
  const remaining = Date.parse(data.expedition.resolve_at) - Date.now()
  return Math.max(1_000, Math.min(60_000, remaining))
}

/**
 * `/expeditions` — mutually exclusive launch vs in-flight state driven by the
 * authoritative current Expedition, with bounded Ship reconciliation on launch
 * and at resolution (§5.6, §3.4).
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

  const resolvedDetail = useQuery({
    queryKey:
      resolved === undefined ? NO_DETAIL_QUERY_KEY : expeditionDetailQueryKeyFor(resolved.base.id),
    queryFn: ({ signal }) => getExpeditionById(transport, resolved?.base.id ?? '', signal),
    enabled: resolved !== undefined,
  })

  // Bounded Ship reward reconciliation after a newly observed resolution.
  const rewardExpected =
    resolved?.balanceAtResolution !== undefined && resolvedDetail.data?.result !== undefined
      ? resolved.balanceAtResolution + resolvedDetail.data.result.material_reward.materials
      : undefined
  const rewardProbe = useShipReconciliation({
    enabled: rewardExpected !== undefined,
    expectedBalance: rewardExpected,
  })
  const rewardSync: MaterialsSync = {
    balance,
    phase: rewardProbe.phase,
    onRetry: rewardProbe.retry,
  }

  // Bounded Ship deduction reconciliation after a launch (§3.4).
  const [deduction, setDeduction] = useState<{ expectedBalance: number | undefined } | undefined>(
    undefined,
  )
  const deductionProbe = useShipReconciliation({
    enabled: deduction !== undefined,
    expectedBalance: deduction?.expectedBalance,
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
  if (currentQuery.isError) {
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
        <ExpeditionProgress expedition={current.expedition} showLinks balanceSync={deductionSync} />
      )
    }
    // Defensive: an authoritative current Expedition that is already resolved
    // shows its result without replaying a celebration.
    return <ResultPanel expeditionId={current.expedition.id} celebrate={false} />
  }

  // No Expedition is current.
  return (
    <div className={styles.overview}>
      {resolved !== undefined ? (
        <>
          <ResultPanel expeditionId={resolved.base.id} celebrate />
          <MaterialsBalance sync={rewardSync} />
        </>
      ) : null}
      <LaunchForm balance={balance} onLaunched={handleLaunched} />
    </div>
  )
}
