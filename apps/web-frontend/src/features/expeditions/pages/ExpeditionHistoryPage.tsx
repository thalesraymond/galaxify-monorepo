import { Link } from 'react-router'
import { useInfiniteQuery } from '@tanstack/react-query'

import {
  Button,
  EmptyState,
  LoadMore,
  LocalTabs,
  Skeleton,
  StatusBadge,
  UnavailableState,
} from '@/shared/ui'
import { useApiTransport } from '@/shared/api/TransportContext'
import { PageHeader } from '@/shared/ui/PageHeader'

import type { Expedition } from '../api/expeditionApi'
import { expeditionHistoryPageOptions } from '../api/expeditionApi'
import { formatAbsoluteTime, formatMaterialReward, formatPercentChance } from '../components/format'
import { expeditionTabs } from '../navigation'
import styles from './ExpeditionHistoryPage.module.css'

const HISTORY_PAGE_SIZE = 10

function outcomeBadge(expedition: Expedition) {
  if (expedition.status === 'IN_FLIGHT') {
    return <span className={styles.inFlight}>In flight</span>
  }
  const outcome =
    expedition.result?.outcome ?? (expedition.status === 'RESOLVED' ? 'SUCCESS' : 'FAILURE')
  return (
    <StatusBadge
      label={outcome === 'SUCCESS' ? 'Success' : 'Failed'}
      status={outcome === 'SUCCESS' ? 'ready' : 'error'}
    />
  )
}

function rewardText(expedition: Expedition): string {
  if (expedition.result === undefined) {
    return '—'
  }
  return formatMaterialReward(expedition.result.material_reward.materials)
}

/**
 * `/expeditions/history` — explicit offset pagination with a stable query key
 * (including the page size) so loaded rows survive detail navigation, and a
 * local Retry that never drops already-loaded rows (§5.7).
 */
export function ExpeditionHistoryPage() {
  const transport = useApiTransport()
  const history = useInfiniteQuery(expeditionHistoryPageOptions(transport, HISTORY_PAGE_SIZE))
  const rows = history.data?.pages.flatMap((page) => page) ?? []
  const hasLoaded = rows.length > 0

  return (
    <>
      <PageHeader title="Expedition history" description="Past Expeditions and their outcomes." />
      <LocalTabs label="Expeditions navigation" tabs={expeditionTabs} />
      {history.isPending ? <Skeleton lines={4} /> : null}
      {history.isError && !hasLoaded ? (
        <UnavailableState
          title="Expedition history is unavailable"
          description="We could not load your past Expeditions. Try again."
          onRetry={() => {
            void history.refetch()
          }}
        />
      ) : null}
      {!history.isPending && !history.isError && !hasLoaded ? (
        <EmptyState
          title="No Expeditions yet"
          action={<Link to="/expeditions">Launch an Expedition</Link>}
        >
          Launch your first Expedition to track its outcome here.
        </EmptyState>
      ) : null}
      {hasLoaded ? (
        <div className={styles.list}>
          <ol className={styles.rows}>
            {rows.map((expedition) => (
              <li key={expedition.id}>
                <Link className={styles.rowLink} to={`/expeditions/${expedition.id}`}>
                  <span className={styles.rowMain}>
                    {outcomeBadge(expedition)}
                    <span>{expedition.materials_invested} materials</span>
                  </span>
                  <span className={styles.rowMeta}>
                    <span>{formatPercentChance(expedition.success_chance)} chance</span>
                    <span>
                      <time dateTime={expedition.created_at}>
                        Launched {formatAbsoluteTime(expedition.created_at)}
                      </time>
                    </span>
                    {expedition.resolved_at !== undefined ? (
                      <span>
                        <time dateTime={expedition.resolved_at}>
                          Resolved {formatAbsoluteTime(expedition.resolved_at)}
                        </time>
                      </span>
                    ) : null}
                    <span className={styles.reward}>{rewardText(expedition)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>

          {history.isError ? (
            <div className={styles.continuationError}>
              <p>Could not load more Expeditions. Your loaded history is still here.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  void history.fetchNextPage()
                }}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {history.hasNextPage && !history.isError ? (
            <LoadMore
              loading={history.isFetchingNextPage}
              onLoadMore={() => {
                void history.fetchNextPage()
              }}
            />
          ) : null}
        </div>
      ) : null}
    </>
  )
}
