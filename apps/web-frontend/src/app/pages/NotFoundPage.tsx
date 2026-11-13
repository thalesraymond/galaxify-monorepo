import { Link } from 'react-router'

import { ContentSurface, EmptyState } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'

export function NotFoundPage() {
  return (
    <div>
      <PageHeader
        title="Page not found"
        description="We could not find that page. Check the address or return to your workspace."
      />
      <ContentSurface>
        <EmptyState
          embedded
          title="No active route at this address"
          action={<Link to="/dashboard">Return to Dashboard</Link>}
        >
          Use the primary navigation or return to Dashboard to pick up today&apos;s routine.
        </EmptyState>
      </ContentSurface>
    </div>
  )
}
