import { LocalTabs } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'
export function DailiesListPage() {
  return (
    <>
      <PageHeader title="Dailies" description="Your recurring Dailies for the selected date." />
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
