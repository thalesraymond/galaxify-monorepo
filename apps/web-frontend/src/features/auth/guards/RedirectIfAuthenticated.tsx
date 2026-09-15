import { Navigate, Outlet, useLocation } from 'react-router'

import { SessionBootstrap } from '../components/SessionBootstrap'
import { SessionUnavailable } from '../components/SessionUnavailable'
import { readSafeReturnRoute } from '../session/returnRoute'
import { useSession } from '../session/SessionProvider'

/**
 * Gate for the auth routes. Authenticated visits redirect to the preserved
 * safe return route, or Dashboard (`docs/specs/web-frontend.md` §5.1).
 */
export function RedirectIfAuthenticated() {
  const { status, manager } = useSession()
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
  if (status === 'authenticated') {
    return <Navigate replace to={readSafeReturnRoute(location.state) ?? '/dashboard'} />
  }
  return <Outlet />
}
