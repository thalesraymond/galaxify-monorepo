import { Navigate } from 'react-router'

/**
 * `/` has no standalone screen. Session-aware routing lands with the auth
 * ticket; the scaffold sends anonymous visitors to `/signup` as specified in
 * `docs/specs/web-frontend.md` §2.
 */
export function HomeRedirect() {
  return <Navigate replace to="/signup" />
}
