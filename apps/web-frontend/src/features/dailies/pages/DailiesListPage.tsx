import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'

import type {
  Daily,
  DailyDifficulty,
  DailyStatus,
  Difficulty,
} from '@/api/generated/daily/types.gen'
import { isApiHttpError, isApiTransportError } from '@/api/transport'
import { useApiTransport } from '@/shared/api/TransportContext'
import {
  Button,
  ConfirmationDialog,
  ContentSurface,
  EmptyState,
  Field,
  LiveRegion,
  LocalTabs,
  Skeleton,
  StatusBadge,
  UnavailableState,
} from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'

import {
  dailiesQueryKey,
  dailyQueryKey,
  deleteDaily,
  difficultiesQueryKey,
  listDailies,
  listDifficulties,
  type DailyListFilters,
} from '../api/dailyApi'
import { DailyRow } from '../components/DailyRow'
import { useDailyCompletion } from '../hooks/useDailyCompletion'
import {
  addDays,
  formatOccurrenceDate,
  isValidDateInput,
  localDayRange,
  todayDateInput,
} from '../lib/dailyTime'
import { dailyTabs } from '../navigation'
import styles from './DailiesListPage.module.css'

type StatusFilter = Extract<DailyStatus, 'PENDING' | 'COMPLETED'> | undefined

const FILTER_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'COMPLETED', label: 'Completed' },
]

function parseDateParam(value: string | null): string | undefined {
  return value !== null && isValidDateInput(value) ? value : undefined
}

function parseStatusParam(value: string | null): StatusFilter {
  return value === 'PENDING' || value === 'COMPLETED' ? value : undefined
}

function byLocalDueTime(left: Daily, right: Daily): number {
  return left.due_local_time.localeCompare(right.due_local_time)
}

function deleteErrorMessage(error: unknown): string {
  if (isApiTransportError(error)) {
    if (error.kind === 'network') {
      return 'Could not reach the Daily service.'
    }
    if (error.kind === 'api') {
      return error.message
    }
  }
  return 'The Daily could not be deleted.'
}

type DailyFocusState = {
  readonly dailyFocus?: {
    readonly dailyId: string
    readonly verb: 'created' | 'updated'
    readonly title: string
  }
}

export function DailiesListPage() {
  const transport = useApiTransport()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  const selectedDate = parseDateParam(searchParams.get('date')) ?? todayDateInput()
  const statusFilter = parseStatusParam(searchParams.get('status'))
  const range = useMemo(() => localDayRange(selectedDate), [selectedDate])
  const filters = useMemo<DailyListFilters>(
    () => ({
      from: range.from,
      to: range.to,
      ...(statusFilter === undefined ? {} : { status: statusFilter }),
    }),
    [range, statusFilter],
  )

  const listQuery = useQuery({
    queryKey: dailiesQueryKey(filters),
    queryFn: ({ signal }) => listDailies(transport, filters, signal),
    // Every failure state exposes its own Retry control (§3.2); the UI
    // recoveries stay deterministic without query-level retry backoff.
    retry: false,
  })
  const difficultiesQuery = useQuery({
    queryKey: difficultiesQueryKey,
    queryFn: ({ signal }) => listDifficulties(transport, signal),
    retry: false,
  })
  const difficultyMap = useMemo(
    () =>
      new Map<Difficulty, DailyDifficulty>(
        (difficultiesQuery.data ?? []).map((meta) => [meta.difficulty, meta]),
      ),
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
      // Pessimistic delete: remove the row and refetch the authoritative list.
      queryClient.setQueryData<Daily[]>(dailiesQueryKey(filters), (current) =>
        current?.filter((daily) => daily.id !== id),
      )
      queryClient.removeQueries({ queryKey: dailyQueryKey(id) })
      void queryClient.invalidateQueries({ queryKey: dailiesQueryKey(filters) })
    },
    onError: (error) => {
      setDeleteError(deleteErrorMessage(error))
    },
  })

  const [currentRowId, setCurrentRowId] = useState<string>()
  const [focusAnnouncement, setFocusAnnouncement] = useState<string>()
  const titleRefs = useRef(new Map<string, HTMLHeadingElement>())
  const consumedFocusRef = useRef<string | undefined>(undefined)
  const focusState = location.state as DailyFocusState | null
  const focusInfo = focusState?.dailyFocus

  // After a save, return to the Daily's local date, identify and focus the
  // changed row, and announce success once (spec §5.3).
  useEffect(() => {
    if (focusInfo === undefined || listQuery.data === undefined) {
      return
    }
    const key = `${focusInfo.verb}:${focusInfo.dailyId}`
    if (consumedFocusRef.current === key) {
      return
    }
    consumedFocusRef.current = key
    const title = titleRefs.current.get(focusInfo.dailyId)
    if (title !== undefined) {
      title.focus()
      setCurrentRowId(focusInfo.dailyId)
    }
    setFocusAnnouncement(
      `${focusInfo.verb === 'created' ? 'Created' : 'Updated'} Daily "${focusInfo.title}".`,
    )
    void navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }, [focusInfo, listQuery.data, location.pathname, location.search, navigate])

  const updateParams = (patch: {
    readonly date?: string
    readonly status?: StatusFilter
  }): void => {
    const next = new URLSearchParams(searchParams)
    if ('date' in patch) {
      if (patch.date === todayDateInput()) {
        next.delete('date')
      } else {
        next.set('date', patch.date ?? '')
      }
    }
    if ('status' in patch) {
      if (patch.status === undefined) {
        next.delete('status')
      } else {
        next.set('status', patch.status)
      }
    }
    setSearchParams(next)
  }

  const previousDay = (): void => {
    updateParams({ date: addDays(selectedDate, -1) })
  }
  const nextDay = (): void => {
    updateParams({ date: addDays(selectedDate, 1) })
  }
  const goToToday = (): void => {
    updateParams({ date: todayDateInput() })
  }

  const retryList = (): void => {
    void listQuery.refetch()
  }

  const openDelete = (daily: Daily): void => {
    setDeleteTarget(daily)
    setDeleteError(undefined)
  }

  const captureTitleRef =
    (id: string) =>
    (element: HTMLHeadingElement | null): void => {
      if (element === null) {
        titleRefs.current.delete(id)
      } else {
        titleRefs.current.set(id, element)
      }
    }

  const renderRow = (daily: Daily): ReactNode => (
    <li key={daily.id} className={styles.rowItem}>
      <DailyRow
        completing={completion.completingDailyId === daily.id}
        daily={daily}
        difficultyMeta={difficultyMap.get(daily.difficulty)}
        failure={completion.failures.get(daily.id)}
        isCurrent={currentRowId === daily.id}
        onComplete={() => {
          completion.complete(daily.id, daily.difficulty)
        }}
        onDelete={() => {
          openDelete(daily)
        }}
        onRetryReconciliation={() => {
          completion.retryReconciliation(daily.id)
        }}
        reconciliation={completion.reconciliations.get(daily.id)}
        titleRef={captureTitleRef(daily.id)}
      />
    </li>
  )

  let body: ReactNode
  const listError = listQuery.error
  if (listQuery.isPending) {
    body = (
      <ContentSurface aria-hidden="true">
        <Skeleton lines={4} />
      </ContentSurface>
    )
  } else if (isApiHttpError(listError, 'DAILY_PLAYER_NOT_READY')) {
    body = (
      <ContentSurface tone="raised">
        <StatusBadge status="preparing" />
        <h2>Preparing your Dailies</h2>
        <p>Your Daily roster is still being prepared. This usually takes a few moments.</p>
        <Button variant="secondary" onClick={retryList}>
          Retry
        </Button>
      </ContentSurface>
    )
  } else if (listQuery.data === undefined) {
    body = (
      <UnavailableState
        title="Dailies are unavailable"
        description="We could not load your Dailies. Try again when you are ready."
        onRetry={retryList}
      />
    )
  } else {
    const dailies = listQuery.data
    const pending = dailies.filter((daily) => daily.status === 'PENDING').sort(byLocalDueTime)
    const completed = dailies.filter((daily) => daily.status === 'COMPLETED').sort(byLocalDueTime)
    body = (
      <>
        {listQuery.isRefetchError ? (
          <div className={styles.staleNote}>
            <StatusBadge status="error" />
            <span>Showing the last confirmed Dailies — refresh failed.</span>
            <Button aria-label="Retry refresh" variant="secondary" onClick={retryList}>
              Retry
            </Button>
          </div>
        ) : null}
        {dailies.length === 0 ? (
          <EmptyState
            title="No Dailies"
            action={
              <Link className={styles.createLink} to="/dailies/new">
                Create Daily
              </Link>
            }
          >
            There are no Dailies for {formatOccurrenceDate(selectedDate)}. Create one to start a
            recurring responsibility.
          </EmptyState>
        ) : (
          <div className={styles.list} aria-busy={listQuery.isFetching || undefined}>
            {statusFilter !== 'COMPLETED' && pending.length > 0 ? (
              <section aria-labelledby="pending-dailies-heading" className={styles.section}>
                <h2 id="pending-dailies-heading">Pending</h2>
                <ul className={styles.rows}>{pending.map(renderRow)}</ul>
              </section>
            ) : null}
            {statusFilter !== 'PENDING' && completed.length > 0 ? (
              <details className={styles.completedSection} open={statusFilter === 'COMPLETED'}>
                <summary>
                  <h2>Completed ({completed.length})</h2>
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
    <div className={styles.page}>
      <PageHeader
        title="Dailies"
        description={`Your recurring Dailies for ${formatOccurrenceDate(selectedDate)}.`}
      />
      <LocalTabs label="Dailies navigation" tabs={dailyTabs} />

      <div className={styles.toolbar}>
        <div className={styles.dateControls} role="group" aria-label="Daily date">
          <Button variant="secondary" onClick={previousDay}>
            Previous day
          </Button>
          <Field
            className={styles.dateInput}
            label="Date"
            type="date"
            value={selectedDate}
            onChange={(event) => {
              updateParams({ date: event.target.value })
            }}
          />
          <Button variant="secondary" onClick={nextDay}>
            Next day
          </Button>
          <Button variant="quiet" onClick={goToToday}>
            Today
          </Button>
        </div>
        <div className={styles.filterControls} role="group" aria-label="Daily status filter">
          {FILTER_OPTIONS.map((option) => (
            <Button
              aria-pressed={statusFilter === option.value}
              className={statusFilter === option.value ? styles.filterActive : undefined}
              key={option.label}
              variant="quiet"
              onClick={() => {
                updateParams({ status: option.value })
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <ContentSurface aria-labelledby="dailies-list-heading">
        <h2 className={styles.listHeading} id="dailies-list-heading">
          Current Dailies
        </h2>
        {body}
      </ContentSurface>

      {focusAnnouncement !== undefined ? <LiveRegion message={focusAnnouncement} /> : null}

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
          // (kept as a statement body for the confirming action)
          title={`Delete "${deleteTarget.title}"?`}
        >
          <p>
            “{deleteTarget.title}” recurrence is removed for future days. Past outcomes stay in
            Daily history.
          </p>
          {deleteError !== undefined ? (
            <p className={styles.deleteError} role="alert">
              {deleteError}
            </p>
          ) : null}
        </ConfirmationDialog>
      ) : null}
    </div>
  )
}
