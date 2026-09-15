import type { UserResponse } from '@/api/generated/user/types.gen'
import { isApiHttpError } from '@/api/transport'

import { AccessTokenStore, readAccessTokenExpiry } from './accessToken'
import type { RefreshTokenStorage } from './refreshTokenStorage'
import type { SessionApi } from './sessionApi'
import type {
  SessionBroadcaster,
  SessionEndedMessage,
  SessionSyncMessage,
} from './sessionBroadcast'
import type { SessionClock } from './sessionClock'
import { SESSION_REFRESH_LOCK, type SessionLock } from './sessionLock'

export type SessionStatus = 'bootstrapping' | 'authenticated' | 'anonymous' | 'unavailable'

export type SessionEndNotice =
  | { readonly kind: 'expired' }
  | { readonly kind: 'signed-out'; readonly revocationConfirmed: boolean }
  | { readonly kind: 'deleted' }

export type SessionSnapshot = {
  readonly status: SessionStatus
  readonly user: UserResponse | undefined
  readonly notice: SessionEndNotice | undefined
}

export type SessionEffects = {
  /** Fired when a session becomes usable; clears prior private cache and seeds identity. */
  readonly onAuthenticated?: (user: UserResponse) => void
  /** Fired when a session ends locally or in another tab; clears private cache. */
  readonly onCleared?: () => void
}

export type RefreshOutcome =
  | { readonly kind: 'refreshed' }
  | { readonly kind: 'terminal' }
  | { readonly kind: 'unavailable'; readonly error: unknown }

export type SessionManagerOptions = {
  readonly api: SessionApi
  readonly tokens: AccessTokenStore
  readonly storage: RefreshTokenStorage
  readonly broadcaster: SessionBroadcaster
  readonly lock: SessionLock
  readonly clock: SessionClock
  /** Rotate when expiry is within this window (`web-frontend.md` §4.2). */
  readonly refreshThresholdMs?: number
  /** A tab is "recently active" if activity occurred within this window. */
  readonly activityWindowMs?: number
}

const DEFAULT_REFRESH_THRESHOLD_MS = 60_000
const DEFAULT_ACTIVITY_WINDOW_MS = 5 * 60_000

/** Revocation is best-effort: local logout completes even if this elapses. */
const LOGOUT_CONFIRMATION_TIMEOUT_MS = 5_000

/**
 * Owns the four-state session model (`bootstrapping`, `authenticated`,
 * `anonymous`, `unavailable`), the in-memory access token, the single-use
 * refresh rotation, and cross-tab synchronization. It is framework-free so the
 * rotation and idle rules can be tested against a fake clock
 * (`docs/specs/web-frontend.md` §4).
 */
export class SessionManager {
  private readonly api: SessionApi
  private readonly tokens: AccessTokenStore
  private readonly storage: RefreshTokenStorage
  private readonly broadcaster: SessionBroadcaster
  private readonly lock: SessionLock
  private readonly clock: SessionClock
  private readonly refreshThresholdMs: number
  private readonly activityWindowMs: number

  private snapshot: SessionSnapshot = {
    status: 'bootstrapping',
    user: undefined,
    notice: undefined,
  }
  private readonly listeners = new Set<(snapshot: SessionSnapshot) => void>()
  private effects: SessionEffects = {}
  private refreshPromise: Promise<RefreshOutcome> | undefined
  private cancelRefreshTimer: (() => void) | undefined
  private cancelActivity: (() => void) | undefined
  private cancelVisibility: (() => void) | undefined
  private cancelStorage: (() => void) | undefined
  private cancelBroadcast: (() => void) | undefined
  private started = false
  private lastActivityAt = 0

  public constructor(options: SessionManagerOptions) {
    this.api = options.api
    this.tokens = options.tokens
    this.storage = options.storage
    this.broadcaster = options.broadcaster
    this.lock = options.lock
    this.clock = options.clock
    this.refreshThresholdMs = options.refreshThresholdMs ?? DEFAULT_REFRESH_THRESHOLD_MS
    this.activityWindowMs = options.activityWindowMs ?? DEFAULT_ACTIVITY_WINDOW_MS
  }

  public readonly getSnapshot = (): SessionSnapshot => this.snapshot

  public readonly subscribe = (listener: (snapshot: SessionSnapshot) => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Registers cache/identity side effects. Returns a detach function. */
  public setEffects(effects: SessionEffects): () => void {
    this.effects = effects
    return () => {
      if (this.effects === effects) {
        this.effects = {}
      }
    }
  }

  public getAccessToken(): string | undefined {
    return this.tokens.get()
  }

  /** Starts bootstrap and cross-tab subscriptions exactly once. */
  public start(): void {
    if (this.started) {
      return
    }
    this.started = true
    this.lastActivityAt = this.clock.now()
    this.cancelActivity = this.clock.subscribeActivity(() => {
      this.lastActivityAt = this.clock.now()
      // A watched, active tab may rotate proactively near expiry.
      this.maybeProactiveRefresh()
    })
    this.cancelVisibility = this.clock.subscribeVisibility((visible) => {
      if (visible) {
        this.maybeProactiveRefresh()
      }
    })
    this.cancelStorage = this.storage.subscribeRefreshToken((token) => {
      if (token === undefined) {
        this.handleRemoteEnd(undefined)
      }
    })
    this.cancelBroadcast = this.broadcaster.subscribe((message) => {
      this.handleBroadcast(message)
    })
    void this.bootstrap()
  }

  /** Releases subscriptions; used by tests and when a runtime is discarded. */
  public dispose(): void {
    this.cancelActivity?.()
    this.cancelVisibility?.()
    this.cancelStorage?.()
    this.cancelBroadcast?.()
    this.cancelRefreshTimer?.()
  }

  /** Retries bootstrap while preserving the stored refresh token (spec §5.1). */
  public retryBootstrap(): void {
    this.update({ status: 'bootstrapping', notice: undefined })
    void this.bootstrap()
  }

  public async signup(input: { email: string; username: string; password: string }): Promise<void> {
    const auth = await this.api.signup(input)
    this.adoptSession(auth.user, auth.access_token, auth.refresh_token)
  }

  public async login(input: { email: string; password: string }): Promise<void> {
    const auth = await this.api.login(input)
    this.adoptSession(auth.user, auth.access_token, auth.refresh_token)
  }

  /**
   * Attempts family revocation, then always clears local state. When the
   * response cannot be confirmed the local sign-out still completes and the
   * notice tells the truth about server revocation (`web-frontend.md` §4.2).
   */
  public async logout(): Promise<void> {
    const token = this.storage.readRefreshToken()
    let revocationConfirmed = false
    if (token !== undefined) {
      // A stalled revocation must never block local logout.
      const controller = new AbortController()
      const cancelTimeout = this.clock.schedule(LOGOUT_CONFIRMATION_TIMEOUT_MS, () => {
        controller.abort()
      })
      try {
        await this.api.logout(token, controller.signal)
        revocationConfirmed = true
      } catch {
        revocationConfirmed = false
      } finally {
        cancelTimeout()
      }
    }
    this.clearLocalSession({ kind: 'signed-out', revocationConfirmed })
  }

  /** Password-confirmed deletion; clears state without a separate logout call. */
  public async deleteAccount(password: string): Promise<void> {
    // Deletion is authenticated work: rotate first when the access token is
    // within the threshold (`web-frontend.md` §4.2).
    await this.ensureFreshToken()
    await this.api.deleteAccount(password)
    this.clearLocalSession({ kind: 'deleted' })
  }

  /** Applies a Player update so identity consumers reflect it immediately. */
  public updateUser(user: UserResponse): void {
    this.update({ user })
  }

  /**
   * Rotates when the access token is within the threshold, used before
   * authenticated work (`web-frontend.md` §4.2).
   */
  public async ensureFreshToken(): Promise<void> {
    if (this.snapshot.status !== 'authenticated') {
      return
    }
    const expiresAt = this.tokens.getExpiresAt()
    if (expiresAt === undefined) {
      return
    }
    if (expiresAt - this.clock.now() > this.refreshThresholdMs) {
      return
    }
    const outcome = await this.refresh()
    if (outcome.kind === 'unavailable') {
      throw outcome.error
    }
  }

  /**
   * The one narrow refresh/replay entry point used by the transport after a
   * bearer-protected `AUTH_INVALID_TOKEN`. Returns whether a replay is safe.
   */
  public async handleUnauthorized(): Promise<boolean> {
    if (this.snapshot.status !== 'authenticated') {
      return false
    }
    const outcome = await this.refresh()
    if (outcome.kind === 'unavailable') {
      throw outcome.error
    }
    return outcome.kind === 'refreshed'
  }

  /**
   * Single-flight rotation. Concurrent callers in one tab share one promise;
   * the Web Lock plus the post-lock storage re-read serialize cross-tab
   * rotation of single-use tokens (`web-frontend.md` §4.2).
   */
  public refresh(): Promise<RefreshOutcome> {
    const existing = this.refreshPromise
    if (existing !== undefined) {
      return existing
    }
    const promise = this.performRefresh()
    this.refreshPromise = promise
    void promise.then(() => {
      if (this.refreshPromise === promise) {
        this.refreshPromise = undefined
      }
    })
    return promise
  }

  private async bootstrap(): Promise<void> {
    if (this.storage.readRefreshToken() === undefined) {
      this.update({ status: 'anonymous', user: undefined, notice: this.snapshot.notice })
      return
    }

    const outcome = await this.refresh()
    if (outcome.kind !== 'refreshed') {
      return
    }

    try {
      await this.ensureUser()
    } catch (error: unknown) {
      if (isTerminalAuthError(error)) {
        this.terminate()
        return
      }
      this.update({ status: 'unavailable' })
      return
    }

    const user = this.snapshot.user
    if (user === undefined) {
      this.update({ status: 'unavailable' })
      return
    }
    this.update({ status: 'authenticated', user, notice: undefined })
    this.effects.onAuthenticated?.(user)
    this.scheduleProactiveRefresh()
  }

  private async performRefresh(): Promise<RefreshOutcome> {
    if (this.storage.readRefreshToken() === undefined) {
      this.terminate()
      return { kind: 'terminal' }
    }

    try {
      const result = await this.lock.run(SESSION_REFRESH_LOCK, async () => {
        // Re-read after acquiring the lock so a rotation in another tab is
        // never overwritten with an already-consumed token.
        const current = this.storage.readRefreshToken()
        if (current === undefined) {
          return 'terminal' as const
        }
        const response = await this.api.refresh(current)
        this.applyTokens(response.access_token, response.refresh_token)
        return 'refreshed' as const
      })

      if (result === 'terminal') {
        this.terminate()
        return { kind: 'terminal' }
      }

      this.broadcaster.send({ type: 'token-replaced' })
      // Do not expose protected content mid-bootstrap; bootstrap promotes the
      // status only after the Player identity resolves.
      if (this.snapshot.status !== 'bootstrapping') {
        this.update({ status: 'authenticated', notice: undefined })
      }
      this.scheduleProactiveRefresh()
      return { kind: 'refreshed' }
    } catch (error: unknown) {
      if (isTerminalAuthError(error)) {
        this.terminate()
        return { kind: 'terminal' }
      }
      this.update({ status: 'unavailable' })
      return { kind: 'unavailable', error }
    }
  }

  private adoptSession(user: UserResponse, accessToken: string, refreshToken: string): void {
    this.applyTokens(accessToken, refreshToken)
    this.update({ status: 'authenticated', user, notice: undefined })
    this.broadcaster.send({ type: 'token-replaced' })
    this.effects.onAuthenticated?.(user)
    this.scheduleProactiveRefresh()
  }

  private applyTokens(accessToken: string, refreshToken: string): void {
    this.tokens.set(accessToken, readAccessTokenExpiry(accessToken))
    this.storage.writeRefreshToken(refreshToken)
  }

  private async ensureUser(): Promise<void> {
    if (this.snapshot.user !== undefined) {
      return
    }
    const user = await this.api.getMe()
    this.update({ user })
  }

  /** Terminal invalidity: clears everything and tells every tab. */
  private terminate(): void {
    this.tokens.clear()
    this.cancelRefreshTimer?.()
    this.cancelRefreshTimer = undefined
    this.storage.clearRefreshToken()
    this.broadcaster.send({ type: 'session-ended', reason: 'expired' })
    this.update({ status: 'anonymous', user: undefined, notice: { kind: 'expired' } })
    this.effects.onCleared?.()
  }

  private clearLocalSession(notice: SessionEndNotice): void {
    this.tokens.clear()
    this.cancelRefreshTimer?.()
    this.cancelRefreshTimer = undefined
    this.storage.clearRefreshToken()
    this.broadcaster.send(toSyncMessage(notice))
    this.update({ status: 'anonymous', user: undefined, notice })
    this.effects.onCleared?.()
  }

  private handleBroadcast(message: SessionSyncMessage): void {
    if (message.type === 'token-replaced') {
      // Another tab rotated. The in-memory access token stays valid until
      // expiry; our next refresh re-reads the persisted replacement.
      return
    }
    this.handleRemoteEnd(message)
  }

  /**
   * A clear from another tab. The durable `storage` signal arrives without a
   * reason, so it signs out generically; a following `session-ended` broadcast
   * refines the notice to the real reason. Never re-clears storage or
   * rebroadcasts (which would loop between tabs).
   */
  private handleRemoteEnd(message: SessionEndedMessage | undefined): void {
    if (message === undefined) {
      // The durable storage signal carries no reason. Apply it from every
      // non-anonymous state, including `unavailable`, so a tab waiting on
      // Retry still clears when another tab ends the session.
      if (this.snapshot.status === 'anonymous') {
        return
      }
      this.applyRemoteEnd({ kind: 'signed-out', revocationConfirmed: false })
      return
    }
    if (this.snapshot.notice?.kind === 'deleted') {
      return
    }
    const notice: SessionEndNotice =
      message.reason === 'expired'
        ? { kind: 'expired' }
        : message.reason === 'deleted'
          ? { kind: 'deleted' }
          : { kind: 'signed-out', revocationConfirmed: message.revocationConfirmed ?? false }
    this.applyRemoteEnd(notice)
  }

  private applyRemoteEnd(notice: SessionEndNotice): void {
    const wasAuthenticated = this.snapshot.status !== 'anonymous'
    this.tokens.clear()
    this.cancelRefreshTimer?.()
    this.cancelRefreshTimer = undefined
    this.update({ status: 'anonymous', user: undefined, notice })
    if (wasAuthenticated) {
      this.effects.onCleared?.()
    }
  }

  private scheduleProactiveRefresh(): void {
    this.cancelRefreshTimer?.()
    this.cancelRefreshTimer = undefined
    if (this.snapshot.status !== 'authenticated') {
      return
    }
    const expiresAt = this.tokens.getExpiresAt()
    if (expiresAt === undefined) {
      return
    }
    const delay = Math.max(0, expiresAt - this.refreshThresholdMs - this.clock.now())
    this.cancelRefreshTimer = this.clock.schedule(delay, () => {
      this.cancelRefreshTimer = undefined
      this.maybeProactiveRefresh()
    })
  }

  /**
   * Refreshes only while the page is visible and the Player was recently
   * active, so idle or hidden tabs never keep extending the session.
   */
  private maybeProactiveRefresh(): void {
    if (this.snapshot.status !== 'authenticated') {
      return
    }
    const expiresAt = this.tokens.getExpiresAt()
    if (expiresAt === undefined || expiresAt - this.clock.now() > this.refreshThresholdMs) {
      return
    }
    if (!this.clock.isVisible() || !this.wasRecentlyActive()) {
      return
    }
    void this.refresh()
  }

  private wasRecentlyActive(): boolean {
    return this.clock.now() - this.lastActivityAt <= this.activityWindowMs
  }

  private update(partial: Partial<SessionSnapshot>): void {
    const next: SessionSnapshot = { ...this.snapshot, ...partial }
    if (
      next.status === this.snapshot.status &&
      next.user === this.snapshot.user &&
      next.notice === this.snapshot.notice
    ) {
      return
    }
    this.snapshot = next
    for (const listener of this.listeners) {
      listener(next)
    }
  }
}

function isTerminalAuthError(error: unknown): boolean {
  return isApiHttpError(error, 'AUTH_INVALID_TOKEN')
}

function toSyncMessage(notice: SessionEndNotice): SessionSyncMessage {
  if (notice.kind === 'expired') {
    return { type: 'session-ended', reason: 'expired' }
  }
  if (notice.kind === 'deleted') {
    return { type: 'session-ended', reason: 'deleted' }
  }
  return {
    type: 'session-ended',
    reason: 'signed-out',
    revocationConfirmed: notice.revocationConfirmed,
  }
}
