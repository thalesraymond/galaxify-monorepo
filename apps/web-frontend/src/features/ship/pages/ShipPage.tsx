import { PageHeader } from '@/shared/ui/PageHeader'

import { ShipStatusPanel } from '../components/ShipStatusPanel'
import styles from './ShipPage.module.css'

export function ShipPage() {
  return (
    <div className={styles.page}>
      <PageHeader title="Ship" description="Hull condition, materials, and repair." />
      <ShipStatusPanel />
    </div>
  )
}
