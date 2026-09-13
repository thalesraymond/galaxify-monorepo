import { useParams } from 'react-router'

import { PageHeader } from '@/shared/ui/PageHeader'

export function EditDailyPage() {
  const { dailyId } = useParams()

  return (
    <PageHeader
      title="Edit a Daily"
      description={`Update the Daily with id ${dailyId ?? 'unknown'}.`}
    />
  )
}
