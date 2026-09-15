import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { ApiTransport } from '@/api/transport'
import { TransportProvider } from '@/shared/api/TransportContext'

import { AccessTokenStore } from './accessToken'
import { LocalRefreshTokenStorage, type RefreshTokenStorage } from './refreshTokenStorage'
import { createSessionApi, type SessionApi } from './sessionApi'
import { BroadcastChannelSessionBroadcaster, type SessionBroadcaster } from './sessionBroadcast'
import { BrowserSessionClock, type SessionClock } from './sessionClock'
import { WebLockSessionLock, type SessionLock } from './sessionLock'
import { SessionManager, type SessionSnapshot } from './sessionManager'

export type SessionRuntime = {
  readonly manager: SessionManager
  readonly transport: ApiTransport
}

export type SessionRuntimeOverrides = {
  readonly storage?: RefreshTokenStorage
  readonly broadcaster?: SessionBroadcaster
  readonly lock?: SessionLock
  readonly clock?: SessionClock
  readonly api?: SessionApi
}

/**
 * Builds the session runtime: one in-memory token holder shared by the
 * session-owned transport (no auth hooks, so auth calls can never recurse) and
 * the feature transport (pre-refresh plus the single replay). Overrides exist
 * so tests can inject fake clocks, storage, and locks.
 */
export function createSessionRuntime(overrides: SessionRuntimeOverrides = {}): SessionRuntime {
  const tokens = new AccessTokenStore()
  const baseOptions = { getAccessToken: () => tokens.get() }

  const sessionTransport = new ApiTransport(baseOptions)
  const manager = new SessionManager({
    api: overrides.api ?? createSessionApi(sessionTransport),
    tokens,
    storage: overrides.storage ?? new LocalRefreshTokenStorage(),
    broadcaster: overrides.broadcaster ?? new BroadcastChannelSessionBroadcaster(),
    lock: overrides.lock ?? new WebLockSessionLock(),
    clock: overrides.clock ?? new BrowserSessionClock(),
  })

  const transport = new ApiTransport({
    ...baseOptions,
    beforeRequest: () => manager.ensureFreshToken(),
    onUnauthorized: () => manager.handleUnauthorized(),
  })

  return { manager, transport }
}

export type SessionContextValue = SessionSnapshot & {
  readonly manager: SessionManager
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined)

/**
 * Owns the session runtime for the application. On every session boundary it
 * clears private query cache so stale protected data can never flash
 * (`web-frontend.md` §4.1, §4.2).
 */
export function SessionProvider({
  children,
  runtime,
}: {
  children: ReactNode
  runtime?: SessionRuntime | undefined
}) {
  const queryClient = useQueryClient()
  const [created] = useState<SessionRuntime>(() => runtime ?? createSessionRuntime())
  const active = runtime ?? created
  const snapshot = useSyncExternalStore(
    active.manager.subscribe,
    active.manager.getSnapshot,
    active.manager.getSnapshot,
  )

  useEffect(() => {
    const detach = active.manager.setEffects({
      onAuthenticated: () => {
        queryClient.clear()
      },
      onCleared: () => {
        queryClient.clear()
      },
    })
    active.manager.start()
    return () => {
      detach()
    }
  }, [active, queryClient])

  const value = useMemo<SessionContextValue>(
    () => ({ ...snapshot, manager: active.manager }),
    [snapshot, active],
  )

  return (
    <TransportProvider transport={active.transport}>
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    </TransportProvider>
  )
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (value === undefined) {
    throw new Error('useSession must be used within a SessionProvider.')
  }
  return value
}
