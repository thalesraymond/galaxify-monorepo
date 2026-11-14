import { Link } from 'react-router'

import type { Daily } from '@/api/generated/daily/types.gen'
import { useDownstreamObservation } from '@/shared/reconciliation'
import { Button, LiveRegion, StatusBadge } from '@/shared/ui'
import { classNames } from '@/shared/ui/classNames'

import type { CompletionFailure, ReconciliationState } from '../hooks/useDailyCompletion'
import { dailyAwardObservationKey } from '../lib/dailyAwardObservation'
import { dueTimeContext } from '../lib/dailyTime'
import type { DifficultyRewards } from '../lib/difficulties'
import styles from './DailyRow.module.css'

/**
 * One current-Daily row: title, concise description, due-time context,
 * difficulty/stakes, status, completion control, edit link, and delete
 * control. Completion, rollback, and reconciliation states stay scoped to the
 * row (spec §5.3, §3.3, §3.4).
 */
export function DailyRow({
  daily,
  difficultyMeta,
  isCurrent,
  titleRef,
  completing,
  failure,
  reconciliation,
  onComplete,
  onDelete,
  onRetryReconciliation,
}: {
  daily: Daily
  difficultyMeta: DifficultyRewards | undefined
  isCurrent: boolean
  titleRef?: (element: HTMLHeadingElement | null) => void
  completing: boolean
  failure: CompletionFailure | undefined
  reconciliation: ReconciliationState | undefined
  onComplete: () => void
  onDelete: () => void
  onRetryReconciliation: () => void
}) {
  const reward = difficultyMeta?.reward
  const damage = difficultyMeta?.damage
  const stakes =
    reward === undefined || damage === undefined
      ? daily.difficulty
      : `${daily.difficulty} · +${reward} materials · −${damage} hull if missed`

  // The completed row displays the affected Ship balance, so it is the visible
  // observer of the expected award: while the row is mounted the bounded round
  // runs, and while no view displays it the round pauses without losing its
  // remaining budget (spec §3.2).
  useDownstreamObservation(dailyAwardObservationKey(daily.id), reconciliation !== undefined)

  return (
    <div className={styles.row} id={`daily-row-${daily.id}`}>
      <div className={styles.text}>
        <div className={styles.rowHead}>
          <h3
            aria-current={isCurrent ? 'true' : undefined}
            className={styles.title}
            ref={titleRef}
            tabIndex={-1}
          >
            {daily.title}
          </h3>
          <span
            className={classNames(
              styles.status,
              daily.status === 'COMPLETED' ? styles.statusCompleted : undefined,
            )}
          >
            {daily.status === 'COMPLETED' ? 'Completed' : 'Pending'}
          </span>
        </div>
        {daily.description !== '' ? (
          <p className={styles.description}>{daily.description}</p>
        ) : null}
        <dl className={styles.facts}>
          <div>
            <dt>Due</dt>
            <dd>{dueTimeContext(daily.due_local_time, daily.time_zone)}</dd>
          </div>
          <div>
            <dt>Difficulty</dt>
            <dd>{stakes}</dd>
          </div>
        </dl>
      </div>

      <div className={styles.actions}>
        <Link className={styles.editLink} to={`/dailies/${daily.id}/edit`}>
          Edit
        </Link>
        <Button aria-label={`Delete ${daily.title}`} variant="danger" onClick={onDelete}>
          Delete
        </Button>
        {daily.status === 'PENDING' ? (
          <Button
            aria-label={`Complete ${daily.title}`}
            disabled={completing}
            loading={completing}
            variant="secondary"
            onClick={onComplete}
          >
            Complete
          </Button>
        ) : (
          <span className={styles.completedLabel}>
            {reconciliation === undefined
              ? 'Completed'
              : `Completed · +${reconciliation.expectedAward} materials`}
          </span>
        )}
      </div>

      {reconciliation !== undefined ? (
        <div className={styles.reconcile}>
          <span>Ship materials: {reconciliation.observed ?? '…'}</span>
          {reconciliation.phase === 'probing' ? <StatusBadge status="updating" /> : null}
          {reconciliation.phase === 'delayed' ? (
            <>
              <StatusBadge status="delayed" />
              <Button variant="secondary" onClick={onRetryReconciliation}>
                Retry
              </Button>
            </>
          ) : null}
          <LiveRegion
            message={
              reconciliation.phase === 'delayed'
                ? `Ship materials update is delayed for ${daily.title}.`
                : `${daily.title} completed. +${reconciliation.expectedAward} materials awarded.`
            }
          />
        </div>
      ) : null}

      {failure !== undefined ? (
        <div className={styles.failure}>
          <p>{failure.message}</p>
          <Button variant="secondary" onClick={onComplete}>
            Retry
          </Button>
          <LiveRegion
            assertive
            message={`Could not complete ${daily.title}. It remains pending.`}
          />
        </div>
      ) : null}
    </div>
  )
}
