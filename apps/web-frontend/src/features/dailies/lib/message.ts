import { isApiTransportError } from '@/api/transport'

/**
 * Feature-owned display text for a mutation/read failure: the backend's own
 * message for HTTP errors, a network explanation, and a caller fallback for
 * anything else.
 */
export function requestFailureMessage(error: unknown, fallback: string): string {
  if (isApiTransportError(error)) {
    if (error.kind === 'network') {
      return 'Could not reach the service. Try again.'
    }
    if (error.kind === 'api') {
      return error.message
    }
  }
  return fallback
}
