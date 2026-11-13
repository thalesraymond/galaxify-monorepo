import { ContentSurface, Skeleton } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'

/**
 * Neutral bootstrap. Protected content must not render until the session
 * resolves, so this shows no private data and no shell-dependent identity
 * (`docs/specs/web-frontend.md` §4).
 */
export function SessionBootstrap() {
  return (
    <div>
      <PageHeader
        title="Restoring your session"
        description="Confirming your sign-in before loading protected content."
      />
      <ContentSurface>
        <Skeleton lines={3} />
        <p role="status" aria-live="polite">
          Preparing…
        </p>
      </ContentSurface>
    </div>
  )
}
