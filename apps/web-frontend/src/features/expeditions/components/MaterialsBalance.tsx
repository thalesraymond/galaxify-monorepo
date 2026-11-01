import { Button, StatusBadge } from '@/shared/ui'
import type { DownstreamObservationPhase } from '@/shared/reconciliation'
import styles from './expeditionPanels.module.css'

export type MaterialsSync = {
  readonly balance: number | undefined
  readonly phase: DownstreamObservationPhase
  readonly onRetry: () => void
}

/**
 * Shows the authoritative Ship materials balance with the bounded
 * reconciliation status adjacent to the affected value (§3.4): an `Updating…`
 * badge while observations run, or `Update delayed` plus a local Retry on expiry.
 */
export function MaterialsBalance({ sync }: { sync: MaterialsSync }) {
  return (
    <p className={styles.balanceSync}>
      <span>Available materials: {sync.balance ?? '—'}</span>
      {sync.phase === 'updating' ? <StatusBadge status="updating" /> : null}
      {sync.phase === 'delayed' ? (
        <>
          <StatusBadge status="delayed" />
          <Button variant="secondary" onClick={sync.onRetry}>
            Retry
          </Button>
        </>
      ) : null}
    </p>
  )
}
