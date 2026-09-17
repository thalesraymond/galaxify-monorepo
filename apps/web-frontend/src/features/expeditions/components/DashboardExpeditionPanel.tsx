import { useId } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'

import { useApiTransport } from '@/shared/api/TransportContext'
import { ContentSurface, Skeleton, UnavailableState } from '@/shared/ui'

import { currentExpeditionQueryKey, getCurrentExpedition } from '../api/expeditionApi'
import { ExpeditionProgress } from './ExpeditionProgress'
import { PreparingPanel } from './ResultPanel'
import { StaleNotice } from './StaleNotice'
import styles from './DashboardExpeditionPanel.module.css'

/**
 * Dashboard-owned Expedition panel (§5.2). Shows in-flight progress or a route
 * to launch — never the full investment form. Reuses the feature-owned current
 * Expedition query so the Dashboard and `/expeditions` share one cache.
 *
 * Provisioning, failures, and stale states replace only this panel.
 */
export function DashboardExpeditionPanel() {
  const transport = useApiTransport()
  const headingId = useId()
  const currentQuery = useQuery({
    queryKey: currentExpeditionQueryKey,
    queryFn: ({ signal }) => getCurrentExpedition(transport, signal),
    retry: false,
  })
  const currentStale = currentQuery.isRefetchError

  if (currentQuery.isPending) {
    return (
      <ContentSurface tone="raised" className={styles.loading} aria-busy="true">
        <Skeleton lines={3} />
      </ContentSurface>
    )
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
        <div className={styles.wrapper}>
          {currentStale ? (
            <StaleNotice
              onRetry={() => {
                void currentQuery.refetch()
              }}
            />
          ) : null}
          <ExpeditionProgress expedition={current.expedition} showLinks balanceSync={undefined} />
        </div>
      )
    }
    // Resolved but still authoritative current: show a link to the detail.
    return (
      <ContentSurface tone="raised" aria-labelledby={headingId}>
        <h2 id={headingId}>Expedition resolved</h2>
        <p>Your latest Expedition has resolved. View its result and launch a new one.</p>
        <nav className={styles.links} aria-label="Expedition links">
          <Link to="/expeditions">Go to Expeditions</Link>
        </nav>
      </ContentSurface>
    )
  }

  // No Expedition is current: offer a route to launch.
  return (
    <ContentSurface tone="raised" aria-labelledby={headingId}>
      <h2 id={headingId}>No Expedition in flight</h2>
      {currentStale ? (
        <StaleNotice
          onRetry={() => {
            void currentQuery.refetch()
          }}
        />
      ) : null}
      <p>Invest materials in an Expedition to earn rewards on success.</p>
      <nav className={styles.links} aria-label="Expedition links">
        <Link to="/expeditions">Launch an Expedition</Link>
        <Link to="/expeditions/history">View history</Link>
      </nav>
    </ContentSurface>
  )
}
