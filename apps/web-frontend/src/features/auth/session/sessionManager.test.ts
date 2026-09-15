import { waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ApiHttpError, ApiNetworkError } from '@/api/transport'
import { createSessionRuntime } from '@/features/auth'
import { createPlayer } from '@/mocks/fixtures'

import {
  asRejection,
  createSessionTestHarness,
  ManualSessionClock,
  MemoryRefreshTokenStorage,
  SharedBroadcastChannel,
  SharedRefreshTokenBacking,
  TestSessionApi,
  TestSessionBroadcaster,
  TestSessionLock,
} from '@/test/sessionTestUtils'

const terminalError: ApiHttpError = {
  kind: 'api',
  status: 401,
  code: 'AUTH_INVALID_TOKEN',
  message: 'The refresh token is invalid.',
  fieldErrors: undefined,
  requestId: undefined,
}

const networkError: ApiNetworkError = {
  kind: 'network',
  requestId: undefined,
  cause: new Error('offline'),
}

describe('SessionManager bootstrap and four-state model', () => {
  it('settles anonymous when no refresh token is stored', async () => {
    const harness = createSessionTestHarness({ authenticated: false })
    harness.runtime.manager.start()

    await waitFor(() => {
      expect(harness.runtime.manager.getSnapshot().status).toBe('anonymous')
    })
    expect(harness.runtime.manager.getAccessToken()).toBeUndefined()
    expect(harness.api.refreshCount).toBe(0)
  })

  it('rotates on startup and resolves the Player into authenticated', async () => {
    const harness = createSessionTestHarness({ authenticated: true })
    harness.runtime.manager.start()

    await waitFor(() => {
      expect(harness.runtime.manager.getSnapshot().status).toBe('authenticated')
    })
    expect(harness.runtime.manager.getSnapshot().user).toEqual(createPlayer())
    expect(harness.runtime.manager.getAccessToken()).toBeDefined()
    // The seeded single-use token was consumed and replaced.
    expect(harness.storage.readRefreshToken()).toBe('test-refresh-1')
  })

  it('enters unavailable and preserves the refresh token on transient failure', async () => {
    const harness = createSessionTestHarness({ authenticated: true })
    harness.api.refreshError = asRejection(networkError)
    harness.runtime.manager.start()

    await waitFor(() => {
      expect(harness.runtime.manager.getSnapshot().status).toBe('unavailable')
    })
    expect(harness.storage.readRefreshToken()).toBe('test-refresh-seed')
    expect(harness.runtime.manager.getSnapshot().notice).toBeUndefined()
  })

  it('recovers from unavailable on retry without re-authenticating', async () => {
    const harness = createSessionTestHarness({ authenticated: true })
    harness.api.refreshError = asRejection(networkError)
    harness.runtime.manager.start()
    await waitFor(() => {
      expect(harness.runtime.manager.getSnapshot().status).toBe('unavailable')
    })

    harness.api.refreshError = undefined
    harness.runtime.manager.retryBootstrap()

    await waitFor(() => {
      expect(harness.runtime.manager.getSnapshot().status).toBe('authenticated')
    })
  })

  it('terminates and clears every trace of a terminal refresh invalidity', async () => {
    const harness = createSessionTestHarness({ authenticated: true })
    const cleared: string[] = []
    harness.runtime.manager.setEffects({ onCleared: () => cleared.push('cleared') })
    harness.api.refreshError = asRejection(terminalError)
    harness.runtime.manager.start()

    await waitFor(() => {
      expect(harness.runtime.manager.getSnapshot().status).toBe('anonymous')
    })
    expect(harness.runtime.manager.getSnapshot().notice).toEqual({ kind: 'expired' })
    expect(harness.storage.readRefreshToken()).toBeUndefined()
    expect(harness.runtime.manager.getAccessToken()).toBeUndefined()
    expect(cleared).toEqual(['cleared'])
  })
})

describe('SessionManager identity operations', () => {
  it('seeds identity and clears prior private cache on signup', async () => {
    const harness = createSessionTestHarness({ authenticated: false })
    const authenticatedUsers: string[] = []
    harness.runtime.manager.setEffects({
      onAuthenticated: (user) => authenticatedUsers.push(user.id),
    })

    await harness.runtime.manager.signup({
      email: 'captain@galaxify.test',
      username: 'captain-logs',
      password: 'password123',
    })

    expect(harness.runtime.manager.getSnapshot().status).toBe('authenticated')
    expect(harness.runtime.manager.getSnapshot().user).toEqual(createPlayer())
    expect(authenticatedUsers).toEqual([createPlayer().id])
    expect(harness.storage.readRefreshToken()).toBe('test-refresh-0')
  })

  it('completes logout locally even when revocation cannot be confirmed', async () => {
    const harness = createSessionTestHarness({ authenticated: true })
    harness.runtime.manager.start()
    await waitFor(() => {
      expect(harness.runtime.manager.getSnapshot().status).toBe('authenticated')
    })

    harness.api.logout = () => Promise.reject(asRejection(networkError))
    await harness.runtime.manager.logout()

    expect(harness.runtime.manager.getSnapshot().status).toBe('anonymous')
    expect(harness.runtime.manager.getSnapshot().notice).toEqual({
      kind: 'signed-out',
      revocationConfirmed: false,
    })
    expect(harness.storage.readRefreshToken()).toBeUndefined()
  })

  it('reports confirmed revocation when the logout response succeeds', async () => {
    const harness = createSessionTestHarness({ authenticated: true })
    harness.runtime.manager.start()
    await waitFor(() => {
      expect(harness.runtime.manager.getSnapshot().status).toBe('authenticated')
    })

    await harness.runtime.manager.logout()

    expect(harness.api.logoutCount).toBe(1)
    expect(harness.runtime.manager.getSnapshot().notice).toEqual({
      kind: 'signed-out',
      revocationConfirmed: true,
    })
  })

  it('deletes the account without calling logout and routes through a purge', async () => {
    const harness = createSessionTestHarness({ authenticated: true })
    harness.runtime.manager.start()
    await waitFor(() => {
      expect(harness.runtime.manager.getSnapshot().status).toBe('authenticated')
    })

    await harness.runtime.manager.deleteAccount('password123')

    expect(harness.api.deleteCount).toBe(1)
    expect(harness.api.logoutCount).toBe(0)
    expect(harness.runtime.manager.getSnapshot().status).toBe('anonymous')
    expect(harness.runtime.manager.getSnapshot().notice).toEqual({ kind: 'deleted' })
    expect(harness.storage.readRefreshToken()).toBeUndefined()
  })

  it('surfaces a deletion failure without clearing the session', async () => {
    const harness = createSessionTestHarness({ authenticated: true })
    harness.runtime.manager.start()
    await waitFor(() => {
      expect(harness.runtime.manager.getSnapshot().status).toBe('authenticated')
    })

    harness.api.deleteAccount = () => Promise.reject(asRejection(terminalError))
    await expect(harness.runtime.manager.deleteAccount('wrong')).rejects.toMatchObject({
      kind: 'api',
      code: 'AUTH_INVALID_TOKEN',
    })

    expect(harness.runtime.manager.getSnapshot().status).toBe('authenticated')
    expect(harness.storage.readRefreshToken()).toBe('test-refresh-1')
  })
})

describe('SessionManager rotation rules', () => {
  it('shares one in-flight refresh among concurrent callers in a tab', async () => {
    const harness = createSessionTestHarness({ authenticated: true })
    harness.runtime.manager.start()
    await waitFor(() => {
      expect(harness.runtime.manager.getSnapshot().status).toBe('authenticated')
    })
    const initial = harness.api.refreshCount

    await Promise.all([
      harness.runtime.manager.refresh(),
      harness.runtime.manager.refresh(),
      harness.runtime.manager.refresh(),
    ])

    expect(harness.api.refreshCount).toBe(initial + 1)
  })

  it('serializes cross-tab rotation and re-reads the persisted token under the lock', async () => {
    const clock = new ManualSessionClock()
    const backing = new SharedRefreshTokenBacking()
    const channel = new SharedBroadcastChannel()
    const lock = new TestSessionLock()
    const api = new TestSessionApi(createPlayer(), clock)

    function openTab(seed: boolean) {
      const storage = new MemoryRefreshTokenStorage(backing)
      if (seed) {
        storage.writeRefreshToken('test-refresh-seed')
      }
      const runtime = createSessionRuntime({
        api,
        storage,
        broadcaster: new TestSessionBroadcaster(channel),
        lock,
        clock,
      })
      return runtime.manager
    }

    const tabA = openTab(true)
    const tabB = openTab(false)

    tabA.start()
    tabB.start()

    await waitFor(() => {
      expect(tabA.getSnapshot().status).toBe('authenticated')
      expect(tabB.getSnapshot().status).toBe('authenticated')
    })

    // Tab A consumed the seed; tab B waited, re-read, and consumed A's
    // replacement rather than presenting an already-used token.
    expect(api.refreshTokenArgs).toHaveLength(2)
    expect(api.refreshTokenArgs[0]).toBe('test-refresh-seed')
    expect(api.refreshTokenArgs[1]).toBe('test-refresh-1')
  })

  it('clears other tabs when one tab hits terminal invalidity', async () => {
    const clock = new ManualSessionClock()
    const backing = new SharedRefreshTokenBacking()
    const channel = new SharedBroadcastChannel()
    const lock = new TestSessionLock()
    const api = new TestSessionApi(createPlayer(), clock)

    function openTab(seed: boolean) {
      const storage = new MemoryRefreshTokenStorage(backing)
      if (seed) {
        storage.writeRefreshToken('test-refresh-seed')
      }
      const runtime = createSessionRuntime({
        api,
        storage,
        broadcaster: new TestSessionBroadcaster(channel),
        lock,
        clock,
      })
      return { manager: runtime.manager, storage }
    }

    const tabA = openTab(true)
    const tabB = openTab(false)
    tabA.manager.start()
    tabB.manager.start()
    await waitFor(() => {
      expect(tabA.manager.getSnapshot().status).toBe('authenticated')
      expect(tabB.manager.getSnapshot().status).toBe('authenticated')
    })

    api.refreshError = asRejection(terminalError)
    await tabA.manager.refresh()

    await waitFor(() => {
      expect(tabA.manager.getSnapshot().status).toBe('anonymous')
      expect(tabB.manager.getSnapshot().status).toBe('anonymous')
    })
    expect(tabB.manager.getSnapshot().notice).toEqual({ kind: 'expired' })
    expect(tabB.storage.readRefreshToken()).toBeUndefined()
  })

  it('rotates before authenticated work when the access token is within the threshold', async () => {
    const harness = createSessionTestHarness({ authenticated: true })
    harness.runtime.manager.start()
    await waitFor(() => {
      expect(harness.runtime.manager.getSnapshot().status).toBe('authenticated')
    })
    const before = harness.api.refreshCount

    // Far from expiry: no rotation.
    await harness.runtime.manager.ensureFreshToken()
    expect(harness.api.refreshCount).toBe(before)

    // Push within 60 seconds of expiry and rotate.
    harness.clock.advance(14 * 60 * 1000)
    await harness.runtime.manager.ensureFreshToken()
    expect(harness.api.refreshCount).toBe(before + 1)
  })

  it('does not extend the session from a hidden, idle tab until the Player returns', async () => {
    const harness = createSessionTestHarness({ authenticated: true })
    harness.runtime.manager.start()
    await waitFor(() => {
      expect(harness.runtime.manager.getSnapshot().status).toBe('authenticated')
    })
    const initialRefreshes = harness.api.refreshCount

    harness.clock.setVisible(false)
    harness.clock.advance(14 * 60 * 1000)
    // The scheduled rotation fired while hidden and was skipped.
    expect(harness.api.refreshCount).toBe(initialRefreshes)

    // Becoming visible alone is not enough while the tab is stale.
    harness.clock.setVisible(true)
    expect(harness.api.refreshCount).toBe(initialRefreshes)

    // Player activity near expiry rotates the token.
    harness.clock.emitActivity()
    await waitFor(() => {
      expect(harness.api.refreshCount).toBe(initialRefreshes + 1)
    })
  })
})

describe('SessionManager resilience', () => {
  it('rotates before deletion when the access token is within the threshold', async () => {
    const harness = createSessionTestHarness({ authenticated: true })
    harness.runtime.manager.start()
    await waitFor(() => {
      expect(harness.runtime.manager.getSnapshot().status).toBe('authenticated')
    })
    const before = harness.api.refreshCount

    harness.clock.advance(14 * 60 * 1000)
    await harness.runtime.manager.deleteAccount('password123')

    expect(harness.api.refreshCount).toBe(before + 1)
    expect(harness.api.deleteCount).toBe(1)
    expect(harness.runtime.manager.getSnapshot().status).toBe('anonymous')
  })

  it('completes local logout when revocation stalls past its timeout', async () => {
    const harness = createSessionTestHarness({ authenticated: true })
    harness.runtime.manager.start()
    await waitFor(() => {
      expect(harness.runtime.manager.getSnapshot().status).toBe('authenticated')
    })

    harness.api.logoutStalls = true
    const logout = harness.runtime.manager.logout()
    // Abort the stalled revocation; local logout must still complete.
    harness.clock.advance(5_000)
    await logout

    expect(harness.api.logoutCount).toBe(1)
    expect(harness.runtime.manager.getSnapshot().status).toBe('anonymous')
    expect(harness.runtime.manager.getSnapshot().notice).toEqual({
      kind: 'signed-out',
      revocationConfirmed: false,
    })
    expect(harness.storage.readRefreshToken()).toBeUndefined()
  })

  it('clears a temporarily unavailable tab when another tab ends the session', async () => {
    const clock = new ManualSessionClock()
    const backing = new SharedRefreshTokenBacking()
    const storage = new MemoryRefreshTokenStorage(backing)
    const otherTabStorage = new MemoryRefreshTokenStorage(backing)
    storage.writeRefreshToken('test-refresh-seed')
    const api = new TestSessionApi(createPlayer(), clock)
    const runtime = createSessionRuntime({
      api,
      storage,
      clock,
      lock: new TestSessionLock(),
      broadcaster: new TestSessionBroadcaster(),
    })

    api.refreshError = asRejection(networkError)
    runtime.manager.start()
    await waitFor(() => {
      expect(runtime.manager.getSnapshot().status).toBe('unavailable')
    })

    // The durable storage signal arrives without a reason and must still clear
    // the unavailable tab.
    otherTabStorage.clearRefreshToken()
    await waitFor(() => {
      expect(runtime.manager.getSnapshot().status).toBe('anonymous')
    })
    expect(runtime.manager.getSnapshot().notice).toEqual({
      kind: 'signed-out',
      revocationConfirmed: false,
    })
  })

  it('stops listening to cross-tab signals after dispose', async () => {
    const clock = new ManualSessionClock()
    const backing = new SharedRefreshTokenBacking()
    const storage = new MemoryRefreshTokenStorage(backing)
    const otherTabStorage = new MemoryRefreshTokenStorage(backing)
    storage.writeRefreshToken('test-refresh-seed')
    const api = new TestSessionApi(createPlayer(), clock)
    const runtime = createSessionRuntime({
      api,
      storage,
      clock,
      lock: new TestSessionLock(),
      broadcaster: new TestSessionBroadcaster(),
    })
    runtime.manager.start()
    await waitFor(() => {
      expect(runtime.manager.getSnapshot().status).toBe('authenticated')
    })

    runtime.manager.dispose()
    otherTabStorage.clearRefreshToken()

    expect(runtime.manager.getSnapshot().status).toBe('authenticated')
  })
})
