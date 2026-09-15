import type { UserResponse } from '@/api/generated/user/types.gen'
import {
  SESSION_REFRESH_STORAGE_KEY,
  createSessionRuntime,
  type SessionRuntime,
} from '@/features/auth'
import type { RefreshTokenStorage } from '@/features/auth/session/refreshTokenStorage'
import type { SessionApi } from '@/features/auth/session/sessionApi'
import type {
  SessionBroadcaster,
  SessionSyncMessage,
} from '@/features/auth/session/sessionBroadcast'
import type { SessionClock } from '@/features/auth/session/sessionClock'
import type { SessionLock } from '@/features/auth/session/sessionLock'

import { createPlayer, FIXED_MOCK_EPOCH_MS } from '@/mocks/fixtures'

/** Deterministic clock with visibility and activity control. */
export class ManualSessionClock implements SessionClock {
  private currentTime: number
  private visible = true
  private readonly visibilityListeners = new Set<(visible: boolean) => void>()
  private readonly activityListeners = new Set<() => void>()
  private readonly tasks: { dueAt: number; task: () => void; cancelled: boolean }[] = []

  public constructor(startTime: number = FIXED_MOCK_EPOCH_MS) {
    this.currentTime = startTime
  }

  public now(): number {
    return this.currentTime
  }

  public schedule(delayMs: number, task: () => void): () => void {
    const scheduled = {
      dueAt: this.currentTime + Math.max(0, delayMs),
      task,
      cancelled: false,
    }
    this.tasks.push(scheduled)
    return () => {
      scheduled.cancelled = true
    }
  }

  public isVisible(): boolean {
    return this.visible
  }

  public subscribeVisibility(listener: (visible: boolean) => void): () => void {
    this.visibilityListeners.add(listener)
    return () => {
      this.visibilityListeners.delete(listener)
    }
  }

  public subscribeActivity(listener: () => void): () => void {
    this.activityListeners.add(listener)
    return () => {
      this.activityListeners.delete(listener)
    }
  }

  public advance(ms: number): void {
    this.currentTime += Math.max(0, ms)
    this.runDue()
  }

  public setVisible(visible: boolean): void {
    this.visible = visible
    for (const listener of this.visibilityListeners) {
      listener(visible)
    }
  }

  public emitActivity(): void {
    for (const listener of this.activityListeners) {
      listener()
    }
  }

  private runDue(): void {
    let next = this.tasks.find((task) => !task.cancelled && task.dueAt <= this.currentTime)
    while (next !== undefined) {
      next.cancelled = true
      next.task()
      next = this.tasks.find((task) => !task.cancelled && task.dueAt <= this.currentTime)
    }
  }
}

/**
 * Shared memory backing for cross-tab simulation. A write notifies every other
 * registered tab, never the writer — mirroring the browser `storage` event.
 */
export class SharedRefreshTokenBacking {
  private token: string | undefined
  private readonly entries = new Map<
    MemoryRefreshTokenStorage,
    (token: string | undefined) => void
  >()

  public read(): string | undefined {
    return this.token
  }

  public write(token: string | undefined, origin: MemoryRefreshTokenStorage): void {
    this.token = token
    for (const [storage, listener] of this.entries) {
      if (storage !== origin) {
        listener(token)
      }
    }
  }

  public register(
    storage: MemoryRefreshTokenStorage,
    listener: (token: string | undefined) => void,
  ): void {
    this.entries.set(storage, listener)
  }

  public unregister(storage: MemoryRefreshTokenStorage): void {
    this.entries.delete(storage)
  }
}

export class MemoryRefreshTokenStorage implements RefreshTokenStorage {
  public constructor(private readonly backing: SharedRefreshTokenBacking) {}

  public readRefreshToken(): string | undefined {
    return this.backing.read()
  }

  public writeRefreshToken(refreshToken: string): void {
    this.backing.write(refreshToken, this)
  }

  public clearRefreshToken(): void {
    this.backing.write(undefined, this)
  }

  public subscribeRefreshToken(listener: (refreshToken: string | undefined) => void): () => void {
    this.backing.register(this, listener)
    return () => {
      this.backing.unregister(this)
    }
  }

  public seed(refreshToken: string): void {
    this.backing.write(refreshToken, this)
  }
}

/** Serializing lock shared by tabs in a test, like the named Web Lock. */
export class TestSessionLock implements SessionLock {
  private tail: Promise<unknown> = Promise.resolve()

  public run<T>(_name: string, task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task)
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

/** Cross-tab broadcast channel: messages reach every other subscriber. */
export class SharedBroadcastChannel {
  private readonly entries = new Map<
    TestSessionBroadcaster,
    (message: SessionSyncMessage) => void
  >()

  public register(
    broadcaster: TestSessionBroadcaster,
    listener: (message: SessionSyncMessage) => void,
  ): void {
    this.entries.set(broadcaster, listener)
  }

  public unregister(broadcaster: TestSessionBroadcaster): void {
    this.entries.delete(broadcaster)
  }

  public post(origin: TestSessionBroadcaster, message: SessionSyncMessage): void {
    for (const [broadcaster, listener] of this.entries) {
      if (broadcaster !== origin) {
        listener(message)
      }
    }
  }
}

export class TestSessionBroadcaster implements SessionBroadcaster {
  public constructor(
    private readonly channel: SharedBroadcastChannel = new SharedBroadcastChannel(),
  ) {}

  public send(message: SessionSyncMessage): void {
    this.channel.post(this, message)
  }

  public subscribe(listener: (message: SessionSyncMessage) => void): () => void {
    this.channel.register(this, listener)
    return () => {
      this.channel.unregister(this)
    }
  }
}

/** Deterministic, mutable `SessionApi` stub for session tests. */
export class TestSessionApi implements SessionApi {
  public refreshCount = 0
  public logoutCount = 0
  public deleteCount = 0
  public refreshError: Error | undefined
  public logoutStalls = false
  public readonly refreshTokenArgs: string[] = []

  public constructor(
    public player: UserResponse,
    private readonly clock: { now(): number },
    private readonly ttlMs = 15 * 60 * 1000,
  ) {}

  public signup(): Promise<{ user: UserResponse; access_token: string; refresh_token: string }> {
    return Promise.resolve(this.session())
  }

  public login(): Promise<{ user: UserResponse; access_token: string; refresh_token: string }> {
    return Promise.resolve(this.session())
  }

  public refresh(refreshToken: string): Promise<{ access_token: string; refresh_token: string }> {
    this.refreshCount += 1
    this.refreshTokenArgs.push(refreshToken)
    if (this.refreshError !== undefined) {
      return Promise.reject(this.refreshError)
    }
    return Promise.resolve({
      access_token: makeAccessToken(this.clock.now() + this.ttlMs),
      refresh_token: `test-refresh-${this.refreshCount}`,
    })
  }

  public logout(_refreshToken?: string, signal?: AbortSignal): Promise<void> {
    this.logoutCount += 1
    if (!this.logoutStalls) {
      return Promise.resolve()
    }
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'))
      })
    })
  }

  public deleteAccount(): Promise<void> {
    this.deleteCount += 1
    return Promise.resolve()
  }

  public getMe(): Promise<UserResponse> {
    return Promise.resolve(this.player)
  }

  private session(): { user: UserResponse; access_token: string; refresh_token: string } {
    return {
      user: this.player,
      access_token: makeAccessToken(this.clock.now() + this.ttlMs),
      refresh_token: 'test-refresh-0',
    }
  }
}

export type SessionTestHarness = {
  readonly runtime: SessionRuntime
  readonly clock: ManualSessionClock
  readonly storage: MemoryRefreshTokenStorage
  readonly broadcaster: TestSessionBroadcaster
  readonly lock: TestSessionLock
  readonly api: TestSessionApi
}

export function createSessionTestHarness(
  options: { readonly authenticated?: boolean; readonly player?: UserResponse | undefined } = {},
): SessionTestHarness {
  const clock = new ManualSessionClock()
  const storage = new MemoryRefreshTokenStorage(new SharedRefreshTokenBacking())
  const broadcaster = new TestSessionBroadcaster()
  const lock = new TestSessionLock()
  const api = new TestSessionApi(options.player ?? createPlayer(), clock)
  if (options.authenticated !== false) {
    storage.seed('test-refresh-seed')
  }
  const runtime = createSessionRuntime({ api, storage, broadcaster, lock, clock })
  return { runtime, clock, storage, broadcaster, lock, api }
}

/** Convenience runtime for component tests that only need an authed shell. */
export function createAuthenticatedSessionRuntime(player?: UserResponse): SessionRuntime {
  return createSessionTestHarness({ authenticated: true, player }).runtime
}

/** Convenience runtime for component tests that need the anonymous state. */
export function createAnonymousSessionRuntime(): SessionRuntime {
  return createSessionTestHarness({ authenticated: false }).runtime
}

/** Wraps a transport-shaped error so `Promise.reject` gets a real Error. */
export function asRejection<T extends object>(error: T): Error & T {
  return Object.assign(new Error('transport error'), error)
}

export function makeAccessToken(expiresAtMs: number): string {
  const header = base64Url({ alg: 'EdDSA', typ: 'JWT', kid: 'test-key' })
  const payload = base64Url({ sub: 'test-player', exp: Math.floor(expiresAtMs / 1000) })
  return `${header}.${payload}.test-signature`
}

function base64Url(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/**
 * Seeds a real authenticated session through the mock backend, mirroring the
 * Profile journey (login fetch → persisted refresh token) so the app shell
 * bootstraps over MSW exactly like the browser. Shared by every mock-backed
 * feature journey.
 */
export async function seedAuthenticatedSession(): Promise<void> {
  const response = await fetch('/api/user/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'captain@galaxify.test', password: 'password123' }),
  })
  const body = (await response.json()) as { refresh_token: string }
  window.localStorage.setItem(
    SESSION_REFRESH_STORAGE_KEY,
    JSON.stringify({ version: 1, refreshToken: body.refresh_token }),
  )
}
