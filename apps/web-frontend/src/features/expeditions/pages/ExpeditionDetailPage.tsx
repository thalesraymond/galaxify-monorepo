import { useParams } from 'react-router'

import { PageHeader } from '@/shared/ui/PageHeader'

export function ExpeditionDetailPage() {
  const { expeditionId } = useParams()

  return (
    <PageHeader
      title="Expedition detail"
      description={`Mission facts and timeline for Expedition ${expeditionId ?? 'unknown'}.`}
    />
  )
}
