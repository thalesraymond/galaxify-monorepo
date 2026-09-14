import { LocalTabs } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'
export function ExpeditionsPage() {
  return (
    <>
      <PageHeader
        title="Expeditions"
        description="Launch eligibility or the Expedition currently in flight."
      />
      <LocalTabs
        label="Expeditions navigation"
        tabs={[
          { to: '/expeditions', label: 'Overview', end: true },
          { to: '/expeditions/history', label: 'History' },
        ]}
      />
    </>
  )
}
