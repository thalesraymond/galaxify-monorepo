import { LocalTabs } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'
export function DailyHistoryPage() {
  return (
    <>
      <PageHeader title="Daily history" description="Archived Daily outcomes, newest first." />
      <LocalTabs
        label="Dailies navigation"
        tabs={[
          { to: '/dailies', label: 'Current', end: true },
          { to: '/dailies/history', label: 'History' },
        ]}
      />
    </>
  )
}
