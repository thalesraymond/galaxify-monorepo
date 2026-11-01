import { useEffect, useId } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Button, ContentSurface, Skeleton, StatusBadge, UnavailableState } from '@/shared/ui'
import { useApiTransport } from '@/shared/api/TransportContext'
import { isApiHttpError } from '@/api/transport'
import type { DownstreamObservationPhase } from '@/shared/reconciliation'

import type { Expedition } from '../api/expeditionApi'
import { expeditionDetailQueryKeyFor, getExpeditionById } from '../api/expeditionApi'
import { registerExpeditionReward } from '../lib/expeditionRewardObservation'
import { ExpeditionRewardSync } from './ExpeditionRewardSync'
import { formatAbsoluteTime, formatMaterialReward } from './format'
import { useCelebration } from './useCelebration'
import {
  isExpeditionResultMissing,
  useExpeditionResultReconciliation,
} from './useExpeditionResultReconciliation'
import { StaleNotice } from './StaleNotice'
import styles from './expeditionPanels.module.css'

/**
 * Resolved Expedition mission facts: outcome and typed material reward
 * dominate, then the launched → resolved timeline. A restrained celebration
 * class plays only for a newly observed result in the current page session
 * (`celebrate`), never on revisit, and never affects comprehension.
 *
 * If the typed result lags the status transition, the panel observes it
 * through the shared Downstream Reconciliation module (immediate then
 * ≈1/2/4/8 active seconds, pausing while hidden/offline/unobserved) showing
 * `Updating…`, then `Update delayed` with a local Retry, before the result is
 * shown (§5.6 "use bounded reconciliation before showing the result").
 */
export function ResultPanel({
  expeditionId,
  celebrate,
  showRewardSync = true,
}: {
  expeditionId: string
  celebrate: boolean
  showRewardSync?: boolean
}) {
  const transport = useApiTransport()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: expeditionDetailQueryKeyFor(expeditionId),
    queryFn: ({ signal }) => getExpeditionById(transport, expeditionId, signal),
  })
  const celebrating = useCelebration(celebrate)
  const headingId = useId()

  const expedition = query.data
  useEffect(() => {
    if (expedition !== undefined) registerExpeditionReward(expedition, queryClient, transport)
  }, [expedition, queryClient, transport])
  const resultMissing = isExpeditionResultMissing(expedition)
  const resultObservation = useExpeditionResultReconciliation(expeditionId, expedition)

  if (query.isPending) {
    return <Skeleton lines={3} />
  }
  if (query.isError && expedition === undefined) {
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
        title="The Expedition result is unavailable"
        description="We could not load the resolved Expedition. Try again."
        onRetry={() => {
          void query.refetch()
        }}
      />
    )
  }
  if (expedition === undefined) {
    return null
  }

  if (resultMissing) {
    return (
      <>
        {query.isRefetchError ? (
          <StaleNotice
            onRetry={() => {
              void query.refetch()
            }}
          />
        ) : null}
        <ResultPending phase={resultObservation.phase} onRetry={resultObservation.retry} />
      </>
    )
  }

  const result = expedition.result
  if (result === undefined) {
    return null
  }
  const succeeded = result.outcome === 'SUCCESS'

  return (
    <ContentSurface
      aria-labelledby={headingId}
      className={celebrating ? styles.celebrate : undefined}
    >
      <div className={styles.resultHeader}>
        <StatusBadge
          status={succeeded ? 'ready' : 'error'}
          label={succeeded ? 'Success' : 'Failed'}
        />
        <h2 id={headingId}>Expedition resolved</h2>
      </div>
      <p className={styles.reward}>{formatMaterialReward(result.material_reward.materials)}</p>
      {showRewardSync ? <ExpeditionRewardSync expeditionId={expeditionId} /> : null}
      <ExpeditionTimeline expedition={expedition} />
    </ContentSurface>
  )
}

/**
 * Bounded reconciliation surface shown while the typed result has not yet
 * landed after the status transition: `Updating…`, or `Update delayed` plus a
 * local Retry on expiry.
 */
function ResultPending({
  phase,
  onRetry,
}: {
  phase: DownstreamObservationPhase
  onRetry: () => void
}) {
  const headingId = useId()
  return (
    <ContentSurface tone="raised" aria-labelledby={headingId}>
      <div className={styles.pendingResult}>
        <h2 id={headingId}>Confirming your result</h2>
        {phase === 'delayed' ? <StatusBadge status="delayed" /> : <StatusBadge status="updating" />}
        <p>
          {phase === 'delayed'
            ? 'Confirming the result is taking longer than expected.'
            : 'The Expedition resolved; confirming its result.'}
        </p>
        {phase === 'delayed' ? (
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </ContentSurface>
  )
}

export function ExpeditionTimeline({ expedition }: { expedition: Expedition }) {
  return (
    <ol className={styles.timeline}>
      <li>
        <span className={styles.timelineLabel}>Launched</span>
        <time dateTime={expedition.created_at}>{formatAbsoluteTime(expedition.created_at)}</time>
      </li>
      {expedition.resolved_at !== undefined ? (
        <li>
          <span className={styles.timelineLabel}>Resolved</span>
          <time dateTime={expedition.resolved_at}>
            {formatAbsoluteTime(expedition.resolved_at)}
          </time>
        </li>
      ) : null}
    </ol>
  )
}

export function PreparingPanel({ onRetry }: { onRetry: () => void }) {
  const headingId = useId()
  return (
    <ContentSurface tone="raised" aria-labelledby={headingId}>
      <h2 id={headingId}>Preparing your Expedition</h2>
      <StatusBadge status="preparing" />
      <p>Your Ship state is still being provisioned. This usually takes a few seconds.</p>
      <Button variant="secondary" onClick={onRetry}>
        Retry
      </Button>
    </ContentSurface>
  )
}
