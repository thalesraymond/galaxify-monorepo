export type AccessTokenState = {
  readonly token: string
  /** Epoch milliseconds at which the token expires, when it can be decoded. */
  readonly expiresAt: number | undefined
}

/**
 * In-memory access-token holder. It is never persisted, never placed in a URL,
 * query key, log, or analytics payload (`web-frontend.md` §4.1).
 */
export class AccessTokenStore {
  private state: AccessTokenState | undefined

  public get(): string | undefined {
    return this.state?.token
  }

  public getExpiresAt(): number | undefined {
    return this.state?.expiresAt
  }

  public set(token: string, expiresAt: number | undefined): void {
    this.state = { token, expiresAt }
  }

  public clear(): void {
    this.state = undefined
  }
}

/**
 * Reads the `exp` claim from a compact JWT without verifying it. Verification
 * is the service's job; the frontend only needs an approximate expiry to
 * decide when to rotate proactively. Returns `undefined` for opaque or
 * malformed tokens, in which case the 401 replay path remains the safety net.
 */
export function readAccessTokenExpiry(token: string): number | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return undefined
  }
  const payload = parts[1]
  if (payload === undefined) {
    return undefined
  }
  try {
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const decoded: unknown = JSON.parse(atob(padded))
    if (typeof decoded !== 'object' || decoded === null || !('exp' in decoded)) {
      return undefined
    }
    const exp: unknown = decoded.exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : undefined
  } catch {
    return undefined
  }
}
