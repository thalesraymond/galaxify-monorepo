/**
 * Return-route handling. Only a validated, same-origin, GET-like internal route
 * survives a session end; tokens and mutation intent are never retained
 * (`docs/specs/web-frontend.md` §4.2, non-goals).
 */
const UNSAFE_RETURN_PREFIXES = ['/login', '/signup'] as const

export function isSafeReturnRoute(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') {
    return false
  }
  // Must be a rooted, same-origin path: reject protocol-relative and absolute
  // URLs, and any control characters.
  if (!value.startsWith('/') || value.startsWith('//')) {
    return false
  }
  if (UNSAFE_RETURN_PREFIXES.some((prefix) => value === prefix || value.startsWith(`${prefix}?`))) {
    return false
  }
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) {
      return false
    }
  }
  return true
}

export function captureReturnRoute(location: {
  readonly pathname: string
  readonly search: string
}): string | undefined {
  const candidate = `${location.pathname}${location.search}`
  return isSafeReturnRoute(candidate) ? candidate : undefined
}

export function readSafeReturnRoute(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null || !('returnTo' in state)) {
    return undefined
  }
  const candidate: unknown = state.returnTo
  return isSafeReturnRoute(candidate) ? candidate : undefined
}
