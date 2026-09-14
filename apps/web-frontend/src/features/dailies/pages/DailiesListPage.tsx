import { LocalTabs } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'
import { dailyTabs } from '../navigation'
export function DailiesListPage() {
  return (
    <>
      <PageHeader title="Dailies" description="Your recurring Dailies for the selected date." />
      <LocalTabs label="Dailies navigation" tabs={dailyTabs} />
    </>
  )
}
