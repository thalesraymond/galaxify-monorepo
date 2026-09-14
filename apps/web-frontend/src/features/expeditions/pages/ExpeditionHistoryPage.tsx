import { LocalTabs } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'
import { expeditionTabs } from '../navigation'
export function ExpeditionHistoryPage() {
  return (
    <>
      <PageHeader title="Expedition history" description="Past Expeditions and their outcomes." />
      <LocalTabs label="Expeditions navigation" tabs={expeditionTabs} />
    </>
  )
}
