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
        title="Preparing your logbook"
        description="Restoring your session before showing protected content."
      />
      <p role="status" aria-live="polite">
        Preparing…
      </p>
    </div>
  )
}
