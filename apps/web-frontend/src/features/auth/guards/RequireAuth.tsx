import { Navigate, Outlet, useLocation } from 'react-router'

import { SessionBootstrap } from '../components/SessionBootstrap'
import { SessionUnavailable } from '../components/SessionUnavailable'
import { captureReturnRoute } from '../session/returnRoute'
import { useSession } from '../session/SessionProvider'

/**
 * Gate for protected routes. Guards keep protected content out of the tree
 * until bootstrap resolves and never render stale private data
 * (`docs/specs/web-frontend.md` §4).
 */
export function RequireAuth() {
  const { status, manager, notice } = useSession()
  const location = useLocation()

  if (status === 'bootstrapping') {
    return <SessionBootstrap />
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
  if (status === 'anonymous') {
    // Account deletion routes to Signup; every other anonymous transition
    // routes to Sign in with a validated return route.
    if (notice?.kind === 'deleted') {
      return <Navigate replace to="/signup" />
    }
    const returnTo = captureReturnRoute(location)
    return <Navigate replace state={returnTo === undefined ? {} : { returnTo }} to="/login" />
  }
  return <Outlet />
}
