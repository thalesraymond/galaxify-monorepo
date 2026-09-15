import { UnavailableState } from '@/shared/ui'
import { PageHeader } from '@/shared/ui/PageHeader'

/**
 * Temporary session unavailability. The stored refresh token is preserved, so
 * Retry re-runs bootstrap without forcing a re-authentication
 * (`docs/specs/web-frontend.md` §4.2, §5.1).
 */
export function SessionUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div>
      <PageHeader title="We could not restore your session" />
      <UnavailableState
        title="Sign-in is temporarily unavailable"
        description="Your saved sign-in is still here. Check your connection and try again."
        onRetry={onRetry}
      />
    </div>
  )
}
