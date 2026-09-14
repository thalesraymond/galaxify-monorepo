import { LocalTabs } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'
import { expeditionTabs } from '../navigation'
export function ExpeditionsPage() {
  return (
    <>
      <PageHeader
        title="Expeditions"
        description="Launch eligibility or the Expedition currently in flight."
      />
      <LocalTabs label="Expeditions navigation" tabs={expeditionTabs} />
    </>
  )
}
