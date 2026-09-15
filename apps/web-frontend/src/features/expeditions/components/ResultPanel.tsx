import { useId } from 'react'

import { useQuery } from '@tanstack/react-query'

import { Button, ContentSurface, Skeleton, StatusBadge, UnavailableState } from '@/shared/ui'
import { useApiTransport } from '@/shared/api/TransportContext'
import { isApiHttpError } from '@/api/transport'

import type { Expedition } from '../api/expeditionApi'
import { expeditionDetailQueryKeyFor, getExpeditionById } from '../api/expeditionApi'
import { formatAbsoluteTime, formatMaterialReward } from './format'
import { useCelebration } from './useCelebration'
import { useBoundedProbe, type BoundedProbePhase } from './useProbeSchedule'
import { StaleNotice } from './StaleNotice'
import styles from './expeditionPanels.module.css'

/**
 * Resolved Expedition mission facts: outcome and typed material reward
 * dominate, then the launched → resolved timeline. A restrained celebration
 * class plays only for a newly observed result in the current page session
 * (`celebrate`), never on revisit, and never affects comprehension.
 *
 * If the typed result lags the status transition, the panel reconciles it
 * through the shared bounded schedule (immediate then ≈1/2/4/8s, pausing while
 * hidden/offline) showing `Updating…`, then `Update delayed` with a local
 * Retry, before the result is shown (§5.6 "use bounded reconciliation before
 * showing the result").
 */
export function ResultPanel({
  expeditionId,
  celebrate,
}: {
  expeditionId: string
  celebrate: boolean
}) {
  const transport = useApiTransport()
  const query = useQuery({
    queryKey: expeditionDetailQueryKeyFor(expeditionId),
    queryFn: ({ signal }) => getExpeditionById(transport, expeditionId, signal),
  })
  const celebrating = useCelebration(celebrate)
  const headingId = useId()

  const expedition = query.data
  const resultMissing =
    expedition !== undefined && expedition.status !== 'IN_FLIGHT' && expedition.result === undefined
  const resultProbe = useBoundedProbe({
    enabled: resultMissing,
    probe: async () => {
      await query.refetch()
      return query.data?.result !== undefined
    },
  })

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
        <ResultPending phase={resultProbe.phase} onRetry={resultProbe.retry} />
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
      <ExpeditionTimeline expedition={expedition} />
    </ContentSurface>
  )
}

/**
 * Bounded reconciliation surface shown while the typed result has not yet
 * landed after the status transition: `Updating…`, or `Update delayed` plus a
 * local Retry on expiry.
 */
function ResultPending({ phase, onRetry }: { phase: BoundedProbePhase; onRetry: () => void }) {
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
