import { Button, StatusBadge } from '@/shared/ui'
import styles from './expeditionPanels.module.css'

/**
 * Stale-refresh label (§3.2): a refetch that failed while confirmed data is
 * still rendered keeps that data on screen, labels it `Update delayed` with a
 * non-color cue, and offers a local Retry — never a silent blank or spinner.
 */
export function StaleNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={styles.staleNotice}>
      <StatusBadge status="delayed" />
      <span>Could not refresh. Showing the last confirmed state.</span>
      <Button variant="secondary" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
