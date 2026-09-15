import type { SessionEndNotice } from '../session/sessionManager'

export function describeSessionNotice(notice: SessionEndNotice | undefined): string {
  if (notice === undefined) {
    return ''
  }
  switch (notice.kind) {
    case 'expired':
      return 'Your session ended. Sign in again.'
    case 'deleted':
      return 'Your account was deleted.'
    case 'signed-out':
      return notice.revocationConfirmed
        ? 'You have been signed out.'
        : 'You have been signed out on this device. The service could not confirm revocation.'
  }
}

/** Visible, announced session notice used on the authentication screens. */
export function SessionNotice({ notice }: { notice: SessionEndNotice | undefined }) {
  const message = describeSessionNotice(notice)
  if (message === '') {
    return null
  }
  return <p role="status">{message}</p>
}
