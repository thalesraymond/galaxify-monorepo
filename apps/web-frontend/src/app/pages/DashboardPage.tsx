import { DashboardDailiesPanel } from '@/features/dailies'
import { DashboardExpeditionPanel } from '@/features/expeditions'
import { ShipStatusPanel } from '@/features/ship'
import { PageHeader } from '@/shared/ui/PageHeader'

import styles from './DashboardPage.module.css'

/**
 * Cross-loop Dashboard (§5.2). Fixed priority: Today's Dailies dominate, Ship
 * second, Expedition third. Desktop uses an asymmetric rail with Dailies in
 * the main column and Ship/Expedition in a narrower support rail; tablet and
 * mobile collapse to a single task-first column.
 *
 * Each panel is feature-owned and reuses its feature's query keys, mutations,
 * and composites. Provisioning and failures replace only the affected panel.
 */
export function DashboardPage() {
  return (
    <div className={styles.page}>
      <PageHeader
        title="Dashboard"
        description="Today's Dailies, Ship status, and Expedition progress."
      />
      <div className={styles.grid}>
        <div className={styles.mainRail}>
          <DashboardDailiesPanel />
        </div>
        <aside className={styles.supportRail} aria-label="Ship and Expedition status">
          <ShipStatusPanel />
          <DashboardExpeditionPanel />
        </aside>
      </div>
    </div>
  )
}
