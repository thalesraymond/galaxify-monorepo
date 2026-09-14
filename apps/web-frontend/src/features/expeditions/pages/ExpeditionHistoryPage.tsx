import { LocalTabs } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'
export function ExpeditionHistoryPage() {
  return (
    <>
      <PageHeader title="Expedition history" description="Past Expeditions and their outcomes." />
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
