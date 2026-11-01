import { PendingExpeditionRewards } from '@/features/expeditions'
import { ShipPage as ShipFeaturePage } from '@/features/ship'

/** The application composes cross-feature observation beside Ship materials. */
export function ShipPage() {
  return <ShipFeaturePage materialsSync={<PendingExpeditionRewards />} />
}
