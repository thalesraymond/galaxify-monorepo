import type { Daily, DailyHistory } from '@/api/generated/daily/types.gen'
import type { Expedition } from '@/api/generated/expedition/types.gen'
import type { Ship } from '@/api/generated/ship/types.gen'
import type { UserResponse } from '@/api/generated/user/types.gen'

import type { MockScenarioName } from './scenarios'

/**
 * Namespaced, versioned mock-backend state (issue #136 resolution, "Stateful
 * and asynchronous mock behavior"). The key embeds both the namespace and the
 * version so incompatible state can never be read by a newer build.
 */
export const MOCK_STATE_NAMESPACE = 'galaxify.mock'
export const MOCK_STATE_VERSION = 1
export const MOCK_STATE_STORAGE_KEY = `${MOCK_STATE_NAMESPACE}.v${MOCK_STATE_VERSION}`
export const MOCK_STATE_BROADCAST_CHANNEL = `${MOCK_STATE_NAMESPACE}.v${MOCK_STATE_VERSION}`

export type MockSessionState = {
  readonly userId: string
  readonly familyId: string
  readonly accessToken: string
  readonly accessTokenExpiresAt: number
}

export type MockRefreshTokenRecord = {
  readonly token: string
  readonly familyId: string
  readonly userId: string
  consumed: boolean
}

export type MockMutationTimestamps = {
  dailyCompletedAt: number | null
  dailyRewardMaterials: number
  shipRepairedAt: number | null
  expeditionLaunchedAt: number | null
  expeditionDeduction: number
  expeditionResolvedAt: number | null
}

export type MockPersistedState = {
  readonly namespace: string
  readonly version: number
  scenario: MockScenarioName
  revision: number
  startedAt: number
  session: MockSessionState | null
  refreshTokens: MockRefreshTokenRecord[]
  player: UserResponse | null
  dailies: Daily[]
  dailyHistory: DailyHistory[]
  ship: Ship | null
  shipMissing: boolean
  expeditions: Expedition[]
  currentExpeditionId: string | null
  mutations: MockMutationTimestamps
}

export function createEmptyMockMutations(): MockMutationTimestamps {
  return {
    dailyCompletedAt: null,
    dailyRewardMaterials: 0,
    shipRepairedAt: null,
    expeditionLaunchedAt: null,
    expeditionDeduction: 0,
    expeditionResolvedAt: null,
  }
}

export interface MockStateStore {
  load(): MockPersistedState | undefined
  save(state: MockPersistedState): void
  clear(): void
  subscribe(listener: (state: MockPersistedState | undefined) => void): () => void
}

function isPersistedState(value: unknown): value is MockPersistedState {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<MockPersistedState>
  return (
    candidate.namespace === MOCK_STATE_NAMESPACE &&
    candidate.version === MOCK_STATE_VERSION &&
    typeof candidate.revision === 'number'
  )
}

/** Test-only store: deterministic, process-local, no cross-tab traffic. */
export class InMemoryMockStateStore implements MockStateStore {
  private state: MockPersistedState | undefined
  private readonly listeners = new Set<(state: MockPersistedState | undefined) => void>()

  public load(): MockPersistedState | undefined {
    return this.state
  }

  public save(state: MockPersistedState): void {
    this.state = state
    this.emit()
  }

  public clear(): void {
    this.state = undefined
    this.emit()
  }

  public subscribe(listener: (state: MockPersistedState | undefined) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * Development store: persists one versioned key and synchronizes across tabs
 * with BroadcastChannel, using the `storage` event as the durable fallback
 * signal. Unreadable or stale-version payloads are ignored and cleared.
 */
export class LocalStorageMockStateStore implements MockStateStore {
  private readonly storage: StorageLike
  private readonly channel: BroadcastChannel | undefined
  private readonly listeners = new Set<(state: MockPersistedState | undefined) => void>()

  public constructor(storage: StorageLike = window.localStorage) {
    this.storage = storage
    this.channel =
      typeof BroadcastChannel === 'undefined'
        ? undefined
        : new BroadcastChannel(MOCK_STATE_BROADCAST_CHANNEL)
    this.channel?.addEventListener('message', this.handleSignal)
    window.addEventListener('storage', this.handleStorageEvent)
  }

  public load(): MockPersistedState | undefined {
    const raw = this.storage.getItem(MOCK_STATE_STORAGE_KEY)
    if (raw === null) {
      return undefined
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isPersistedState(parsed)) {
        this.storage.removeItem(MOCK_STATE_STORAGE_KEY)
        return undefined
      }
      return parsed
    } catch {
      this.storage.removeItem(MOCK_STATE_STORAGE_KEY)
      return undefined
    }
  }

  public save(state: MockPersistedState): void {
    this.storage.setItem(MOCK_STATE_STORAGE_KEY, JSON.stringify(state))
    this.broadcast()
  }

  public clear(): void {
    this.storage.removeItem(MOCK_STATE_STORAGE_KEY)
    this.broadcast()
  }

  public subscribe(listener: (state: MockPersistedState | undefined) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Releases cross-tab listeners; used when a mock server session ends. */
  public dispose(): void {
    this.channel?.removeEventListener('message', this.handleSignal)
    this.channel?.close()
    window.removeEventListener('storage', this.handleStorageEvent)
  }

  private broadcast(): void {
    this.channel?.postMessage({ type: 'mock-state-changed' })
  }

  private readonly handleSignal = (): void => {
    this.emit(this.load())
  }

  private readonly handleStorageEvent = (event: StorageEvent): void => {
    if (event.key === null || event.key === MOCK_STATE_STORAGE_KEY) {
      this.emit(this.load())
    }
  }

  private emit(state: MockPersistedState | undefined): void {
    for (const listener of this.listeners) {
      listener(state)
    }
  }
}
