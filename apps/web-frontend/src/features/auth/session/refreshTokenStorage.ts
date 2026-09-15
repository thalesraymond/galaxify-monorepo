import { z } from 'zod'

/**
 * The single versioned localStorage key allowed to persist session material.
 * Only the opaque refresh token is stored; the access token lives in memory
 * (`docs/specs/web-frontend.md` §4.1).
 */
export const SESSION_REFRESH_STORAGE_KEY = 'galaxify.session.refresh.v1'
export const SESSION_REFRESH_STORAGE_VERSION = 1

const zPersistedRefreshToken = z.object({
  version: z.literal(SESSION_REFRESH_STORAGE_VERSION),
  refreshToken: z.string().min(1),
})

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface RefreshTokenStorage {
  readRefreshToken(): string | undefined
  writeRefreshToken(refreshToken: string): void
  clearRefreshToken(): void
  /**
   * Durable cross-tab signal. Fires for changes made by another tab (the
   * browser never dispatches a `storage` event to the writing document).
   */
  subscribeRefreshToken(listener: (refreshToken: string | undefined) => void): () => void
}

/**
 * Reads and writes the versioned refresh-token key. Payloads with the wrong
 * version or shape are treated as absent and cleared, never trusted.
 */
export class LocalRefreshTokenStorage implements RefreshTokenStorage {
  public constructor(private readonly storage: StorageLike = window.localStorage) {}

  public readRefreshToken(): string | undefined {
    const raw = this.storage.getItem(SESSION_REFRESH_STORAGE_KEY)
    if (raw === null) {
      return undefined
    }
    try {
      const parsed = zPersistedRefreshToken.safeParse(JSON.parse(raw) as unknown)
      if (!parsed.success) {
        this.storage.removeItem(SESSION_REFRESH_STORAGE_KEY)
        return undefined
      }
      return parsed.data.refreshToken
    } catch {
      this.storage.removeItem(SESSION_REFRESH_STORAGE_KEY)
      return undefined
    }
  }

  public writeRefreshToken(refreshToken: string): void {
    this.storage.setItem(
      SESSION_REFRESH_STORAGE_KEY,
      JSON.stringify({ version: SESSION_REFRESH_STORAGE_VERSION, refreshToken }),
    )
  }

  public clearRefreshToken(): void {
    this.storage.removeItem(SESSION_REFRESH_STORAGE_KEY)
  }

  public subscribeRefreshToken(listener: (refreshToken: string | undefined) => void): () => void {
    const handleStorage = (event: StorageEvent): void => {
      if (event.key === null || event.key === SESSION_REFRESH_STORAGE_KEY) {
        listener(this.readRefreshToken())
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('storage', handleStorage)
    }
  }
}
