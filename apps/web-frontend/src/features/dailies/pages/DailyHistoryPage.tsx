import { LocalTabs } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'
import { dailyTabs } from '../navigation'
export function DailyHistoryPage() {
  return (
    <>
      <PageHeader title="Daily history" description="Archived Daily outcomes, newest first." />
      <LocalTabs label="Dailies navigation" tabs={dailyTabs} />
    </>
  )
}
