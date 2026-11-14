import { DashboardExpeditionPanel, PendingExpeditionRewards } from '@/features/expeditions'
import { ShipStatusPanel } from '@/features/ship'
import { PageHeader } from '@/shared/ui/PageHeader'

import styles from './ShipPage.module.css'

/** The application composes cross-feature observation beside Ship materials. */
export function ShipPage() {
  return (
    <div className={styles.page}>
      <PageHeader title="Ship" description="Hull condition, materials, and repair." />
      <div className={styles.grid}>
        <ShipStatusPanel materialsSync={<PendingExpeditionRewards />} />
        <DashboardExpeditionPanel showRewardSync={false} />
      </div>
    </div>
  )
}
