import { ShipStatusPanel } from '@/features/ship'
import { LocalTabs } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'

import { ExpeditionOverview } from '../components/ExpeditionOverview'
import { LaunchDeductionSync } from '../components/LaunchDeductionSync'
import { expeditionTabs } from '../navigation'
import styles from './ExpeditionsPage.module.css'

export function ExpeditionsPage() {
  return (
    <>
      <PageHeader
        title="Expeditions"
        description="Launch eligibility or the Expedition currently in flight."
      />
      <LocalTabs label="Expeditions navigation" tabs={expeditionTabs} />
      <div className={styles.pair}>
        <ExpeditionOverview />
        <ShipStatusPanel materialsSync={<LaunchDeductionSync />} />
      </div>
    </>
  )
}
