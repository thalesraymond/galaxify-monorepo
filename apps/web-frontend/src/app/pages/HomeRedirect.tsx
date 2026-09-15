import { Navigate } from 'react-router'

import { SessionBootstrap, SessionUnavailable, useSession } from '@/features/auth'

/**
 * `/` has no standalone screen. Redirect authenticated Players to Dashboard and
 * anonymous visitors to Signup; a session still resolving shows the neutral
 * bootstrap, and a temporary failure offers Retry without clearing the token
 * (`docs/specs/web-frontend.md` §2, §4.2).
 */
export function HomeRedirect() {
  const { status, manager } = useSession()

  if (status === 'authenticated') {
    return <Navigate replace to="/dashboard" />
  }
  if (status === 'anonymous') {
    return <Navigate replace to="/signup" />
  }
  if (status === 'unavailable') {
    return (
      <SessionUnavailable
        onRetry={() => {
          manager.retryBootstrap()
        }}
      />
    )
  }
  return <SessionBootstrap />
}
