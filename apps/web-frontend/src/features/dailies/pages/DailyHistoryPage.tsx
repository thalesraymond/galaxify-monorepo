import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'

import type { DailyHistory } from '@/api/generated/daily/types.gen'
import { useApiTransport } from '@/shared/api/TransportContext'
import {
  ContentSurface,
  Disclosure,
  EmptyState,
  LoadMore,
  LocalTabs,
  Skeleton,
  StatusBadge,
  UnavailableState,
} from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'

import {
  dailyHistoryQueryKey,
  difficultiesQueryKey,
  listDailyHistory,
  listDifficulties,
} from '../api/dailyApi'
import { difficultyRewardsMap, type DifficultyRewards } from '../lib/difficulties'
import { dueTimeContext, formatOccurrenceDate, formatTimeInZone } from '../lib/dailyTime'
import { dailyTabs } from '../navigation'
import styles from './DailyHistoryPage.module.css'

const PAGE_SIZE = 10

type Effect = { readonly text: string; readonly tone: 'reward' | 'damage' }

export function DailyHistoryPage() {
  const transport = useApiTransport()

  const historyQuery = useInfiniteQuery({
    queryKey: dailyHistoryQueryKey(),
    queryFn: ({ pageParam, signal }) =>
      listDailyHistory(
        transport,
        { limit: PAGE_SIZE, ...(pageParam === undefined ? {} : { cursor: pageParam }) },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
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

  const groups = useMemo(() => {
    const result: {
      readonly date: string
      readonly timeZone: string
      readonly items: DailyHistory[]
    }[] = []
    const byDate = new Map<string, DailyHistory[]>()
    for (const page of historyQuery.data?.pages ?? []) {
      for (const item of page.items) {
        const group = byDate.get(item.due_local_date)
        if (group === undefined) {
          byDate.set(item.due_local_date, [item])
        } else {
          group.push(item)
        }
      }
    }
    for (const [date, items] of byDate) {
      const first = items[0]
      result.push({ date, timeZone: first?.time_zone ?? 'UTC', items })
    }
    return result
  }, [historyQuery.data])

  const pagesLoaded = (historyQuery.data?.pages.length ?? 0) > 0
  const continuationFailed = historyQuery.isError && pagesLoaded

  let body: ReactNode
  if (historyQuery.isPending) {
    body = (
      <ContentSurface aria-hidden="true">
        <Skeleton lines={5} />
      </ContentSurface>
    )
  } else if (historyQuery.isError && !pagesLoaded) {
    body = (
      <UnavailableState
        title="Daily history is unavailable"
        onRetry={() => {
          void historyQuery.refetch()
        }}
      />
    )
  } else if (groups.length === 0) {
    body = (
      <EmptyState
        title="No Daily history yet"
        action={
          <Link className={styles.createLink} to="/dailies/new">
            Create Daily
          </Link>
        }
      >
        Completed and missed Dailies appear here after their due time passes.
      </EmptyState>
    )
  } else {
    body = (
      <div className={styles.history}>
        {groups.map((group) => (
          <section
            aria-labelledby={`history-group-${group.date}`}
            className={styles.group}
            key={group.date}
          >
            <h2 id={`history-group-${group.date}`} className={styles.groupHeading}>
              {formatOccurrenceDate(group.date)}
              <span className={styles.groupZone}>{group.timeZone}</span>
            </h2>
            <ul className={styles.rows}>
              {group.items.map((item) => (
                <li key={item.id}>
                  <HistoryRow item={item} difficultyMeta={difficultyMap.get(item.difficulty)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        <div className={styles.footer}>
          {continuationFailed ? (
            <p className={styles.footerError} role="alert">
              Could not load more outcomes.
            </p>
          ) : null}
          {historyQuery.hasNextPage ? (
            <LoadMore
              loading={historyQuery.isFetchingNextPage}
              onLoadMore={() => {
                void historyQuery.fetchNextPage().catch(() => undefined)
              }}
            />
          ) : null}
          {continuationFailed ? (
            <button
              aria-label="Retry loading more history"
              className={styles.footerRetry}
              onClick={() => {
                void historyQuery.fetchNextPage().catch(() => undefined)
              }}
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader title="Daily history" description="Archived Daily outcomes, newest first." />
      <LocalTabs label="Dailies navigation" tabs={dailyTabs} />
      <ContentSurface aria-labelledby="daily-history-heading">
        <h2 className={styles.heading} id="daily-history-heading">
          Outcomes
        </h2>
        {body}
      </ContentSurface>
    </div>
  )
}

function HistoryRow({
  item,
  difficultyMeta,
}: {
  item: DailyHistory
  difficultyMeta: DifficultyRewards | undefined
}) {
  const effect = effectFor(item, difficultyMeta)
  const outcomeAt =
    item.completed_at !== null ? item.completed_at : item.missed_at !== null ? item.missed_at : ''
  const outcomeTime = outcomeAt === '' ? '' : formatTimeInZone(outcomeAt, item.time_zone)

  return (
    <article className={styles.row}>
      <div className={styles.rowHead}>
        <h3 className={styles.title}>{item.title}</h3>
        <StatusBadge
          label={item.status === 'COMPLETED' ? 'Completed' : 'Missed'}
          status={item.status === 'COMPLETED' ? 'ready' : 'error'}
        />
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>Difficulty</dt>
          <dd>{item.difficulty}</dd>
        </div>
        <div>
          <dt>Due</dt>
          <dd>{dueTimeContext(item.due_local_time, item.time_zone)}</dd>
        </div>
        {outcomeTime !== '' ? (
          <div>
            <dt>{item.status === 'COMPLETED' ? 'Completed at' : 'Missed at'}</dt>
            <dd>{outcomeTime}</dd>
          </div>
        ) : null}
      </dl>
      {effect !== undefined ? (
        <span className={`${styles.effect} ${styles[effect.tone]}`}>{effect.text}</span>
      ) : null}
      {item.description !== '' ? (
        <Disclosure summary="Show description">
          <p className={styles.description}>{item.description}</p>
        </Disclosure>
      ) : null}
    </article>
  )
}

function effectFor(
  item: DailyHistory,
  difficultyMeta: DifficultyRewards | undefined,
): Effect | undefined {
  if (item.status === 'COMPLETED') {
    const reward = difficultyMeta?.reward
    return reward === undefined ? undefined : { text: `+${reward} materials`, tone: 'reward' }
  }
  if (item.status === 'MISSED') {
    const damage = difficultyMeta?.damage
    return damage === undefined ? undefined : { text: `−${damage} hull`, tone: 'damage' }
  }
  return undefined
}
