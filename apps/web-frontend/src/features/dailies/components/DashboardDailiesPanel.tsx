import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { Daily } from '@/api/generated/daily/types.gen'
import { isApiHttpError } from '@/api/transport'
import { useApiTransport } from '@/shared/api/TransportContext'
import {
  Button,
  ConfirmationDialog,
  ContentSurface,
  EmptyState,
  Skeleton,
  StatusBadge,
  UnavailableState,
} from '@/shared/ui'

import {
  dailiesQueryKey,
  dailyQueryKey,
  deleteDaily,
  difficultiesQueryKey,
  listDailies,
  listDifficulties,
  type DailyListFilters,
} from '../api/dailyApi'
import { DailyRow } from './DailyRow'
import { useDailyCompletion } from '../hooks/useDailyCompletion'
import { difficultyRewardsMap } from '../lib/difficulties'
import { localDayRange, todayDateInput, formatOccurrenceDate } from '../lib/dailyTime'
import { requestFailureMessage } from '../lib/message'
import styles from './DashboardDailiesPanel.module.css'

function byLocalDueTime(left: Daily, right: Daily): number {
  return left.due_local_time.localeCompare(right.due_local_time)
}

/**
 * Dashboard-owned Today's Dailies panel (§5.2). Pending Dailies dominate,
 * ordered by local due time; completed Dailies collapse behind a disclosure.
 * Reuses the feature-owned query keys, completion hook, and row component so
 * the Dashboard and `/dailies` share one cache and one mutation path.
 *
 * Empty day remains first and offers Create Daily. Provisioning and failures
 * replace only this panel.
 */
export function DashboardDailiesPanel() {
  const transport = useApiTransport()
  const queryClient = useQueryClient()
  const today = todayDateInput()
  const range = useMemo(() => localDayRange(today), [today])
  const filters = useMemo<DailyListFilters>(() => ({ from: range.from, to: range.to }), [range])

  const listQuery = useQuery({
    queryKey: dailiesQueryKey(filters),
    queryFn: ({ signal }) => listDailies(transport, filters, signal),
    retry: false,
  })
  const difficultiesQuery = useQuery({
    queryKey: difficultiesQueryKey,
    queryFn: ({ signal }) => listDifficulties(transport, signal),
    retry: false,
  })
  const difficultyMap = useMemo(
    () => difficultyRewardsMap(difficultiesQuery.data),
    [difficultiesQuery.data],
  )

  const completion = useDailyCompletion(transport, filters, difficultyMap)

  const [deleteTarget, setDeleteTarget] = useState<Daily>()
  const [deleteError, setDeleteError] = useState<string>()
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDaily(transport, id),
    onSuccess: (_result, id) => {
      setDeleteTarget(undefined)
      setDeleteError(undefined)
      queryClient.setQueryData<Daily[]>(dailiesQueryKey(filters), (current) =>
        current?.filter((daily) => daily.id !== id),
      )
      queryClient.removeQueries({ queryKey: dailyQueryKey(id) })
      void queryClient.invalidateQueries({ queryKey: dailiesQueryKey(filters) })
    },
    onError: (error) => {
      setDeleteError(requestFailureMessage(error, 'The Daily could not be deleted.'))
    },
  })

  const renderRow = (daily: Daily): ReactNode => (
    <li key={daily.id} className={styles.rowItem}>
      <DailyRow
        completing={completion.completingDailyId === daily.id}
        daily={daily}
        difficultyMeta={difficultyMap.get(daily.difficulty)}
        failure={completion.failures.get(daily.id)}
        isCurrent={false}
        onComplete={() => {
          completion.complete(daily.id, daily.difficulty)
        }}
        onDelete={() => {
          setDeleteTarget(daily)
          setDeleteError(undefined)
        }}
        onRetryReconciliation={() => {
          completion.retryReconciliation(daily.id)
        }}
        reconciliation={completion.reconciliations.get(daily.id)}
      />
    </li>
  )

  let body: ReactNode
  const listError = listQuery.error
  if (listQuery.isPending) {
    body = (
      <div className={styles.loading} aria-busy="true">
        <Skeleton lines={3} />
      </div>
    )
  } else if (isApiHttpError(listError, 'DAILY_PLAYER_NOT_READY')) {
    body = (
      <div className={styles.stateBlock}>
        <StatusBadge status="preparing" />
        <h3>Preparing your Dailies</h3>
        <p>Your Daily roster is still being prepared. This usually takes a few moments.</p>
        <Button variant="secondary" onClick={() => void listQuery.refetch()}>
          Retry
        </Button>
      </div>
    )
  } else if (listQuery.data === undefined) {
    body = (
      <UnavailableState
        title="Dailies are unavailable"
        description="We could not load your Dailies. Try again when you are ready."
        onRetry={() => void listQuery.refetch()}
      />
    )
  } else {
    const dailies = listQuery.data
    const pending = dailies.filter((d) => d.status === 'PENDING').sort(byLocalDueTime)
    const completed = dailies.filter((d) => d.status === 'COMPLETED').sort(byLocalDueTime)
    body = (
      <>
        {listQuery.isRefetchError ? (
          <div className={styles.staleNote}>
            <StatusBadge status="error" />
            <span>Showing the last confirmed Dailies — refresh failed.</span>
            <Button
              aria-label="Retry Dailies refresh"
              variant="secondary"
              onClick={() => void listQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : null}
        {dailies.length === 0 ? (
          <EmptyState
            title="No Dailies for today"
            action={
              <Link className={styles.createLink} to="/dailies/new">
                Create Daily
              </Link>
            }
          >
            There are no Dailies for {formatOccurrenceDate(today)}. Create one to start a recurring
            responsibility.
          </EmptyState>
        ) : (
          <div className={styles.list} aria-busy={listQuery.isFetching || undefined}>
            {pending.length > 0 ? (
              <section aria-labelledby="dashboard-pending-heading" className={styles.section}>
                <h3 id="dashboard-pending-heading">Pending</h3>
                <ul className={styles.rows}>{pending.map(renderRow)}</ul>
              </section>
            ) : null}
            {completed.length > 0 ? (
              <details className={styles.completedSection}>
                <summary>
                  <h3>Completed ({completed.length})</h3>
                </summary>
                <ul className={styles.rows}>{completed.map(renderRow)}</ul>
              </details>
            ) : null}
          </div>
        )}
      </>
    )
  }

  return (
    <ContentSurface aria-labelledby="dashboard-dailies-heading" className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 id="dashboard-dailies-heading">Today's Dailies</h2>
        <Link className={styles.viewAllLink} to="/dailies">
          View all
        </Link>
      </div>
      {body}

      {deleteTarget !== undefined ? (
        <ConfirmationDialog
          confirmLabel="Delete Daily"
          onCancel={() => {
            setDeleteTarget(undefined)
            setDeleteError(undefined)
          }}
          onConfirm={() => {
            deleteMutation.mutate(deleteTarget.id)
          }}
          title={`Delete "${deleteTarget.title}"?`}
        >
          <p>
            "{deleteTarget.title}" recurrence is removed for future days. Past outcomes stay in
            Daily history.
          </p>
          {deleteError !== undefined ? (
            <p className={styles.deleteError} role="alert">
              {deleteError}
            </p>
          ) : null}
        </ConfirmationDialog>
      ) : null}
    </ContentSurface>
  )
}
