import { beforeEach, describe, expect, it } from 'vitest'

import {
  LocalRefreshTokenStorage,
  SESSION_REFRESH_STORAGE_KEY,
  SESSION_REFRESH_STORAGE_VERSION,
} from './refreshTokenStorage'

describe('LocalRefreshTokenStorage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('persists only the versioned opaque refresh token in one key', () => {
    const storage = new LocalRefreshTokenStorage()
    storage.writeRefreshToken('opaque-refresh-token')

    expect(window.localStorage.length).toBe(1)
    const raw = window.localStorage.getItem(SESSION_REFRESH_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw ?? '{}')).toEqual({
      version: SESSION_REFRESH_STORAGE_VERSION,
      refreshToken: 'opaque-refresh-token',
    })
    expect(storage.readRefreshToken()).toBe('opaque-refresh-token')
  })

  it('clears the key without leaving a tombstone', () => {
    const storage = new LocalRefreshTokenStorage()
    storage.writeRefreshToken('token')
    storage.clearRefreshToken()

    expect(window.localStorage.length).toBe(0)
    expect(storage.readRefreshToken()).toBeUndefined()
  })

  it('ignores and clears malformed or stale-version payloads', () => {
    const storage = new LocalRefreshTokenStorage()
    window.localStorage.setItem(SESSION_REFRESH_STORAGE_KEY, '{not json')
    expect(storage.readRefreshToken()).toBeUndefined()
    expect(window.localStorage.getItem(SESSION_REFRESH_STORAGE_KEY)).toBeNull()

    window.localStorage.setItem(
      SESSION_REFRESH_STORAGE_KEY,
      JSON.stringify({ version: 99, refreshToken: 'stale' }),
    )
    expect(storage.readRefreshToken()).toBeUndefined()
    expect(window.localStorage.getItem(SESSION_REFRESH_STORAGE_KEY)).toBeNull()
  })
})
