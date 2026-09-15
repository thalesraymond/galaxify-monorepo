import { useEffect, useRef, useState } from 'react'

import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'

import { isApiHttpError } from '@/api/transport'
import { useApiTransport } from '@/shared/api/TransportContext'
import { LocalTabs, Skeleton, UnavailableState } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'

import type { Expedition } from '../api/expeditionApi'
import { expeditionDetailQueryKeyFor, getExpeditionById } from '../api/expeditionApi'
import { ExpeditionNotFound } from '../components/ExpeditionNotFound'
import { ExpeditionProgress } from '../components/ExpeditionProgress'
import { boundedResolvePollMs } from '../components/polling'
import { PreparingPanel, ResultPanel } from '../components/ResultPanel'
import { StaleNotice } from '../components/StaleNotice'
import { expeditionTabs } from '../navigation'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/** Bounded poll while an in-flight Expedition is visible; stops once resolved. */
function detailPollInterval(expedition: Expedition | undefined): number | false {
  if (expedition?.status !== 'IN_FLIGHT') {
    return false
  }
  return boundedResolvePollMs(expedition.resolve_at)
}

/**
 * `true` only when this mounted component observed the transition from
 * in-flight to resolved/failed — never on a revisit or reload.
 */
function useNewlyObservedResolution(expedition: Expedition | undefined): boolean {
  const [newlyObserved, setNewlyObserved] = useState(false)
  const prevStatusRef = useRef<Expedition['status'] | undefined>(undefined)

  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = expedition?.status
    if (expedition !== undefined && prev === 'IN_FLIGHT' && expedition.status !== 'IN_FLIGHT') {
      setNewlyObserved(true)
    }
  }, [expedition])

  return newlyObserved
}

/**
 * `/expeditions/:expeditionId` — one mission-facts/timeline layout: countdown
 * dominates in flight; the typed result and reward dominate after resolution;
 * not-found and provisioning recover inside the shell; a failed refetch keeps
 * the last confirmed state labelled stale with Retry (§3.2, §5.7).
 */
export function ExpeditionDetailPage() {
  const { expeditionId } = useParams()

  return (
    <>
      <PageHeader title="Expedition detail" description="Mission facts and timeline." />
      <LocalTabs label="Expeditions navigation" tabs={expeditionTabs} />
      {expeditionId === undefined || !UUID_PATTERN.test(expeditionId) ? (
        <ExpeditionNotFound />
      ) : (
        <ExpeditionDetail expeditionId={expeditionId} />
      )}
    </>
  )
}

function ExpeditionDetail({ expeditionId }: { expeditionId: string }) {
  const transport = useApiTransport()
  const query = useQuery({
    queryKey: expeditionDetailQueryKeyFor(expeditionId),
    queryFn: ({ signal }) => getExpeditionById(transport, expeditionId, signal),
    refetchInterval: (query) => detailPollInterval(query.state.data),
  })
  const newlyObserved = useNewlyObservedResolution(query.data)

  if (query.isPending) {
    return <Skeleton lines={4} />
  }
  if (query.isError && query.data === undefined) {
    if (isApiHttpError(query.error, 'EXPEDITION_NOT_FOUND')) {
      return <ExpeditionNotFound />
    }
    if (isApiHttpError(query.error, 'EXPEDITION_SHIP_STATE_NOT_READY')) {
      return (
        <PreparingPanel
          onRetry={() => {
            void query.refetch()
          }}
        />
      )
    }
    return (
      <UnavailableState
        title="This Expedition is unavailable"
        description="We could not load this Expedition. Try again."
        onRetry={() => {
          void query.refetch()
        }}
      />
    )
  }

  const expedition = query.data
  return (
    <div>
      {query.isRefetchError ? (
        <StaleNotice
          onRetry={() => {
            void query.refetch()
          }}
        />
      ) : null}
      {expedition.status === 'IN_FLIGHT' ? (
        <ExpeditionProgress expedition={expedition} showLinks={false} />
      ) : (
        <ResultPanel expeditionId={expeditionId} celebrate={newlyObserved} />
      )}
    </div>
  )
}
