import type { z } from 'zod'

import type {
  Daily,
  DailyCompletion,
  DailyDifficulty,
  DailyHistoryPage,
} from '@/api/generated/daily/types.gen'
import type { zCreateDailyRequest, zUpdateDailyRequest } from '@/api/generated/daily/zod.gen'
import type {
  Expedition,
  ExpeditionQuote,
  LaunchExpeditionRequest,
} from '@/api/generated/expedition/types.gen'
import type { Ship } from '@/api/generated/ship/types.gen'
import type {
  AuthSessionResponse,
  LoginRequest,
  LogoutRequest,
  RefreshRequest,
  RefreshResponse,
  SignupRequest,
  UpdateMeRequest,
  UserResponse,
} from '@/api/generated/user/types.gen'

import type { MockScheduler } from './clock'
import { SystemMockScheduler } from './clock'
import {
  createActiveExpedition,
  createDamagedShip,
  createEstablishedDailies,
  createHealthyShip,
  createPlayer,
  createResolvedDailyHistory,
  createResolvedExpeditionHistory,
  FIXED_DIFFICULTY_METADATA,
  FIXED_USER_ID,
  fixedUuid,
} from './fixtures'
import type { MockScenarioName } from './scenarios'
import {
  createEmptyMockMutations,
  InMemoryMockStateStore,
  MOCK_STATE_NAMESPACE,
  MOCK_STATE_VERSION,
  type MockPersistedState,
  type MockRefreshTokenRecord,
  type MockStateStore,
} from './state'

/** Small fixed delay so loading states are observable without being tedious. */
export const DEFAULT_MOCK_RESPONSE_DELAY_MS = 120

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000
const PROVISIONING_WINDOW_MS = 5_000
const PROPAGATION_WINDOW_MS = 2_000

/**
 * The frontend's bounded reconciliation window (web-frontend.md §3.4) is ~8s.
 * The `delayed-propagation` scenario pushes its window far beyond it so the UI
 * must surface an explicit `Update delayed` / stale state.
 */
const STALE_PROPAGATION_WINDOW_MS = 5 * 60 * 1000

export type CreateDailyInput = z.infer<typeof zCreateDailyRequest>
export type UpdateDailyInput = z.infer<typeof zUpdateDailyRequest>

export class MockApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Readonly<Record<string, string>>,
  ) {
    super(message)
    this.name = 'MockApiError'
  }
}

export type MockBackendOptions = {
  readonly scenario: MockScenarioName
  readonly scheduler?: MockScheduler
  readonly store?: MockStateStore
  readonly responseDelayMs?: number
}

type ScenarioDefinition = {
  readonly authenticated: boolean
  readonly provisioning: boolean
  readonly ship: 'healthy' | 'damaged' | 'missing'
  readonly dailies: 'established' | 'none'
  readonly currentExpedition: 'none' | 'active'
  readonly history: boolean
  readonly expiredSession: boolean
  readonly outage: boolean
  readonly propagationWindowMs: number
  readonly permanentlyStaleReconciliation: boolean
}

const SCENARIO_DEFINITIONS: Readonly<Record<MockScenarioName, ScenarioDefinition>> = {
  anonymous: definition({ authenticated: false }),
  provisioning: definition({
    authenticated: true,
    provisioning: true,
    ship: 'missing',
    dailies: 'none',
  }),
  'established-player': definition({}),
  'damaged-ship': definition({ ship: 'damaged' }),
  'expedition-ready': definition({ history: false }),
  'active-expedition': definition({ currentExpedition: 'active' }),
  'resolved-expedition': definition({}),
  'expired-session': definition({ expiredSession: true }),
  'service-outage': definition({ outage: true }),
  'delayed-propagation': definition({
    propagationWindowMs: STALE_PROPAGATION_WINDOW_MS,
    permanentlyStaleReconciliation: true,
  }),
}

function definition(overrides: Partial<ScenarioDefinition>): ScenarioDefinition {
  return {
    authenticated: true,
    provisioning: false,
    ship: 'healthy',
    dailies: 'established',
    currentExpedition: 'none',
    history: true,
    expiredSession: false,
    outage: false,
    propagationWindowMs: PROPAGATION_WINDOW_MS,
    permanentlyStaleReconciliation: false,
    ...overrides,
  }
}

export type MockDailyQuery = {
  readonly status?: string
  readonly from?: string
  readonly to?: string
}

export type MockHistoryQuery = {
  readonly cursor?: string
  readonly limit?: number
}

export type MockExpeditionListQuery = {
  readonly limit?: number
  readonly offset?: number
}

export class MockBackend {
  private readonly scheduler: MockScheduler
  private readonly store: MockStateStore
  private readonly responseDelayMs: number
  private definition: ScenarioDefinition
  private state: MockPersistedState
  private requestCounter = 0
  private tokenCounter = 0

  public constructor(options: MockBackendOptions) {
    this.definition = SCENARIO_DEFINITIONS[options.scenario]
    this.scheduler = options.scheduler ?? new SystemMockScheduler()
    this.store = options.store ?? new InMemoryMockStateStore()
    this.responseDelayMs = options.responseDelayMs ?? DEFAULT_MOCK_RESPONSE_DELAY_MS

    const persisted = this.store.load()
    this.state =
      persisted !== undefined && persisted.scenario === options.scenario
        ? persisted
        : this.createInitialState(options.scenario)
    this.store.subscribe((external) => {
      this.handleExternalState(external)
    })
    this.persist()
  }

  /** Deterministic request ID used when a caller omits `X-Request-Id`. */
  public nextRequestId(): string {
    this.requestCounter += 1
    return `mock-request-${this.requestCounter}`
  }

  public async awaitResponseDelay(): Promise<void> {
    await this.scheduler.delay(this.responseDelayMs)
  }

  public getScenario(): MockScenarioName {
    return this.state.scenario
  }

  public reset(scenario: MockScenarioName = this.state.scenario): void {
    this.store.clear()
    this.definition = SCENARIO_DEFINITIONS[scenario]
    this.state = this.createInitialState(scenario)
    this.persist()
  }

  // --- Authentication ------------------------------------------------------

  public signup(body: SignupRequest): AuthSessionResponse {
    this.guardOutage('user')
    if (body.email.trim() === '' || body.username.trim() === '' || body.password.length < 8) {
      throw new MockApiError(422, 'VALIDATION_FAILED', 'Signup details are invalid.', {
        ...(body.email.trim() === '' ? { email: 'Email is required.' } : {}),
        ...(body.username.trim() === '' ? { username: 'Username is required.' } : {}),
        ...(body.password.length < 8
          ? { password: 'Password must be at least 8 characters.' }
          : {}),
      })
    }
    const player = createPlayer({
      email: body.email.trim().toLowerCase(),
      username: body.username.trim(),
    })
    this.state.player = player
    return this.issueSession(player.id)
  }

  public login(body: LoginRequest): AuthSessionResponse {
    this.guardOutage('user')
    const player = this.state.player ?? createPlayer()
    this.state.player = player
    if (body.email.trim().toLowerCase() !== player.email || body.password.length < 8) {
      throw new MockApiError(401, 'USER_INVALID_CREDENTIALS', 'Email or password is incorrect.')
    }
    return this.issueSession(player.id)
  }

  public refresh(body: RefreshRequest): RefreshResponse {
    this.guardOutage('user')
    const record = this.state.refreshTokens.find((token) => token.token === body.refresh_token)
    if (record === undefined) {
      throw new MockApiError(401, 'AUTH_INVALID_TOKEN', 'The refresh token is invalid.')
    }
    if (record.consumed) {
      // Single-use token reuse invalidates the whole family.
      this.invalidateFamily(record.familyId)
      throw new MockApiError(401, 'AUTH_INVALID_TOKEN', 'The refresh token was already used.')
    }
    record.consumed = true
    const session = this.issueSession(record.userId, record.familyId)
    return { access_token: session.access_token, refresh_token: session.refresh_token }
  }

  public logout(body: LogoutRequest): void {
    this.guardOutage('user')
    const record = this.state.refreshTokens.find((token) => token.token === body.refresh_token)
    if (record !== undefined) {
      this.invalidateFamily(record.familyId)
    }
    this.state.session = null
    this.persist()
  }

  public getMe(accessToken: string | undefined): UserResponse {
    this.guardOutage('user')
    this.requireSession(accessToken)
    if (this.state.player === null) {
      throw new MockApiError(401, 'AUTH_INVALID_TOKEN', 'The session has no Player.')
    }
    return this.state.player
  }

  public updateMe(accessToken: string | undefined, body: UpdateMeRequest): UserResponse {
    this.guardOutage('user')
    this.requireSession(accessToken)
    if (this.state.player === null) {
      throw new MockApiError(404, 'USER_NOT_FOUND', 'The Player does not exist.')
    }
    if (body.username.trim().length < 3) {
      throw new MockApiError(422, 'VALIDATION_FAILED', 'Username is invalid.', {
        username: 'Username must be at least 3 characters.',
      })
    }
    this.state.player = { ...this.state.player, username: body.username.trim() }
    this.persist()
    return this.state.player
  }

  public deleteMe(accessToken: string | undefined, body: { readonly password: string }): void {
    this.guardOutage('user')
    this.requireSession(accessToken)
    if (body.password.length < 8) {
      throw new MockApiError(422, 'VALIDATION_FAILED', 'Password is incorrect.', {
        password: 'Password must be at least 8 characters.',
      })
    }
    this.state.session = null
    this.state.player = null
    this.state.refreshTokens = []
    this.persist()
  }

  // --- Dailies -------------------------------------------------------------

  public listDailies(accessToken: string | undefined, query: MockDailyQuery): Daily[] {
    this.guardOutage('daily')
    this.requireSession(accessToken)
    this.guardDailyProvisioning()
    this.materialize()
    return this.state.dailies
      .filter((daily) => (query.status === undefined ? true : daily.status === query.status))
      .filter((daily) => (query.from === undefined ? true : daily.due_date >= query.from))
      .filter((daily) => (query.to === undefined ? true : daily.due_date < query.to))
  }

  public createDaily(accessToken: string | undefined, body: CreateDailyInput): Daily {
    this.guardOutage('daily')
    this.requireSession(accessToken)
    this.guardDailyProvisioning()
    if (body.title.trim() === '') {
      throw new MockApiError(422, 'VALIDATION_FAILED', 'A title is required.', {
        title: 'A title is required.',
      })
    }
    const id = fixedUuid(5, this.state.dailies.length + 1)
    const daily: Daily = {
      id,
      user_id: FIXED_USER_ID,
      title: body.title.trim(),
      description: body.description ?? '',
      difficulty: body.difficulty,
      due_date: body.due_date ?? `${body.due_local_date ?? '2026-01-15'}T12:00:00Z`,
      status: 'PENDING',
      created_at: new Date(this.scheduler.now()).toISOString(),
      updated_at: new Date(this.scheduler.now()).toISOString(),
      time_zone: body.time_zone,
      due_local_date: body.due_local_date ?? '2026-01-15',
      due_local_time: body.due_local_time ?? '12:00',
    }
    this.state.dailies = [...this.state.dailies, daily]
    this.persist()
    return daily
  }

  public listDailyHistory(
    accessToken: string | undefined,
    query: MockHistoryQuery,
  ): DailyHistoryPage {
    this.guardOutage('daily')
    this.requireSession(accessToken)
    this.guardDailyProvisioning()
    const limit = query.limit ?? this.state.dailyHistory.length
    const offset = query.cursor === undefined ? 0 : Number.parseInt(query.cursor, 10) || 0
    const items = this.state.dailyHistory.slice(offset, offset + limit)
    const nextOffset = offset + items.length
    return {
      items,
      next_cursor: nextOffset < this.state.dailyHistory.length ? String(nextOffset) : null,
    }
  }

  public listDifficulties(accessToken: string | undefined): DailyDifficulty[] {
    this.guardOutage('daily')
    this.requireSession(accessToken)
    return [...FIXED_DIFFICULTY_METADATA]
  }

  public getDaily(accessToken: string | undefined, id: string): Daily {
    this.guardOutage('daily')
    this.requireSession(accessToken)
    this.guardDailyProvisioning()
    return this.requireDaily(id)
  }

  public updateDaily(accessToken: string | undefined, id: string, body: UpdateDailyInput): Daily {
    this.guardOutage('daily')
    this.requireSession(accessToken)
    this.guardDailyProvisioning()
    const daily = this.requireDaily(id)
    if (body.title !== undefined) {
      daily.title = body.title
    }
    if (body.description !== undefined) {
      daily.description = body.description
    }
    if (body.difficulty !== undefined) {
      daily.difficulty = body.difficulty
    }
    if (body.time_zone !== undefined) {
      daily.time_zone = body.time_zone
    }
    if (body.due_local_date !== undefined) {
      daily.due_local_date = body.due_local_date
    }
    if (body.due_local_time !== undefined) {
      daily.due_local_time = body.due_local_time
    }
    daily.updated_at = new Date(this.scheduler.now()).toISOString()
    this.persist()
    return daily
  }

  public deleteDaily(accessToken: string | undefined, id: string): void {
    this.guardOutage('daily')
    this.requireSession(accessToken)
    this.guardDailyProvisioning()
    this.requireDaily(id)
    this.state.dailies = this.state.dailies.filter((daily) => daily.id !== id)
    this.persist()
  }

  public completeDaily(accessToken: string | undefined, id: string): DailyCompletion {
    this.guardOutage('daily')
    this.requireSession(accessToken)
    this.guardDailyProvisioning()
    const daily = this.requireDaily(id)
    if (daily.status === 'COMPLETED') {
      throw new MockApiError(409, 'DAILY_ALREADY_COMPLETED', 'This Daily is already complete.')
    }
    daily.status = 'COMPLETED'
    daily.updated_at = new Date(this.scheduler.now()).toISOString()
    this.state.mutations.dailyCompletedAt = this.scheduler.now()
    this.state.mutations.dailyRewardMaterials =
      FIXED_DIFFICULTY_METADATA.find((meta) => meta.difficulty === daily.difficulty)
        ?.reward_materials ?? 0
    const awardedMaterials = this.state.mutations.dailyRewardMaterials
    const completedAt = new Date(this.scheduler.now()).toISOString()
    this.state.dailyHistory = [
      {
        id: fixedUuid(6, this.state.dailyHistory.length + 1),
        daily_id: daily.id,
        user_id: FIXED_USER_ID,
        title: daily.title,
        description: daily.description,
        difficulty: daily.difficulty,
        due_date: daily.due_date,
        time_zone: daily.time_zone,
        due_local_date: daily.due_local_date,
        due_local_time: daily.due_local_time,
        status: 'COMPLETED',
        completed_at: completedAt,
        missed_at: null,
        archived_at: completedAt,
      },
      ...this.state.dailyHistory,
    ]
    this.persist()
    return { ...daily, awarded_materials: awardedMaterials }
  }

  // --- Ship ----------------------------------------------------------------

  public getShip(accessToken: string | undefined): Ship {
    this.guardOutage('ship')
    this.requireSession(accessToken)
    if (this.state.shipMissing) {
      throw new MockApiError(404, 'SHIP_NOT_FOUND', 'The Ship is still provisioning.')
    }
    this.materialize()
    if (this.state.ship === null) {
      throw new MockApiError(404, 'SHIP_NOT_FOUND', 'The Ship is still provisioning.')
    }
    return this.state.ship
  }

  public repairShip(accessToken: string | undefined): Ship {
    this.guardOutage('ship')
    this.requireSession(accessToken)
    this.materialize()
    if (this.state.ship === null) {
      throw new MockApiError(404, 'SHIP_NOT_FOUND', 'The Ship is still provisioning.')
    }
    const ship = this.state.ship
    if (ship.hull_health >= 100) {
      throw new MockApiError(422, 'SHIP_HULL_FULL', 'The hull is already at full health.')
    }
    if (ship.materials_balance <= 0) {
      throw new MockApiError(422, 'SHIP_INSUFFICIENT_MATERIALS', 'There are no materials to spend.')
    }
    const spent = Math.min(ship.materials_balance, 100 - ship.hull_health)
    ship.hull_health = Math.min(100, ship.hull_health + spent)
    ship.materials_balance -= spent
    ship.updated_at = new Date(this.scheduler.now()).toISOString()
    this.state.mutations.shipRepairedAt = this.scheduler.now()
    this.persist()
    return ship
  }

  // --- Expeditions ---------------------------------------------------------

  public getCurrentExpedition(accessToken: string | undefined): Expedition {
    this.guardOutage('expedition')
    this.requireSession(accessToken)
    this.guardExpeditionReadiness()
    this.materialize()
    const current = this.findCurrentExpedition()
    if (current === undefined) {
      throw new MockApiError(404, 'EXPEDITION_NOT_FOUND', 'There is no active Expedition.')
    }
    return current
  }

  public listExpeditions(
    accessToken: string | undefined,
    query: MockExpeditionListQuery,
  ): Expedition[] {
    this.guardOutage('expedition')
    this.requireSession(accessToken)
    this.materialize()
    const offset = query.offset ?? 0
    const limit = query.limit ?? this.state.expeditions.length
    return this.state.expeditions.slice(offset, offset + limit)
  }

  public getExpeditionQuote(
    accessToken: string | undefined,
    materialsInvested: number,
  ): ExpeditionQuote {
    this.guardOutage('expedition')
    this.requireSession(accessToken)
    this.guardExpeditionReadiness()
    this.materialize()
    const ship = this.state.ship
    const balance = ship?.materials_balance ?? 0
    const current = this.findCurrentExpedition()
    const normalized = Math.max(0, Math.trunc(materialsInvested))
    const blocker =
      current !== undefined
        ? 'EXPEDITION_ALREADY_ACTIVE'
        : normalized <= 0 || normalized > balance
          ? 'EXPEDITION_INSUFFICIENT_MATERIALS'
          : null
    const normalizedInvestment = balance <= 0 ? 0 : Math.min(1, normalized / balance)
    const successChance = Math.min(0.95, normalizedInvestment * 0.95)
    return {
      materials_invested: normalized,
      normalized_investment: normalizedInvestment,
      projected_balance: balance - normalized,
      success_chance: blocker === null ? successChance : 0,
      eligible: blocker === null,
      blocker,
      cooldown_until: null,
      estimated_resolve_at: new Date(this.scheduler.now() + 60 * 60 * 1000).toISOString(),
      estimated_resolve_window_seconds: 3600,
    }
  }

  public getExpedition(accessToken: string | undefined, id: string): Expedition {
    this.guardOutage('expedition')
    this.requireSession(accessToken)
    this.materialize()
    const expedition = this.state.expeditions.find((candidate) => candidate.id === id)
    if (expedition === undefined) {
      throw new MockApiError(404, 'EXPEDITION_NOT_FOUND', 'That Expedition does not exist.')
    }
    return expedition
  }

  public launchExpedition(
    accessToken: string | undefined,
    body: LaunchExpeditionRequest,
  ): Expedition {
    this.guardOutage('expedition')
    this.requireSession(accessToken)
    this.guardExpeditionReadiness()
    this.materialize()
    if (this.findCurrentExpedition() !== undefined) {
      throw new MockApiError(
        409,
        'EXPEDITION_ALREADY_ACTIVE',
        'An Expedition is already in flight.',
      )
    }
    const ship = this.state.ship
    if (ship === null || body.materials_invested > ship.materials_balance) {
      throw new MockApiError(
        422,
        'EXPEDITION_INSUFFICIENT_MATERIALS',
        'There are not enough materials to invest.',
      )
    }
    const expedition: Expedition = {
      id: fixedUuid(7, this.state.expeditions.length + 1),
      user_id: FIXED_USER_ID,
      materials_invested: Math.trunc(body.materials_invested),
      success_chance: Math.min(0.95, body.materials_invested / ship.materials_balance),
      resolve_at: new Date(this.scheduler.now() + 60 * 60 * 1000).toISOString(),
      status: 'IN_FLIGHT',
      created_at: new Date(this.scheduler.now()).toISOString(),
    }
    this.state.expeditions = [expedition, ...this.state.expeditions]
    this.state.currentExpeditionId = expedition.id
    this.state.mutations.expeditionLaunchedAt = this.scheduler.now()
    this.state.mutations.expeditionDeduction = expedition.materials_invested
    this.persist()
    return expedition
  }

  // --- Internals -----------------------------------------------------------

  private handleExternalState(external: MockPersistedState | undefined): void {
    if (external === undefined) {
      this.definition = SCENARIO_DEFINITIONS[this.state.scenario]
      this.state = this.createInitialState(this.state.scenario)
      return
    }
    if (external.scenario === this.state.scenario && external.revision > this.state.revision) {
      this.state = external
      this.definition = SCENARIO_DEFINITIONS[external.scenario]
    }
  }

  private createInitialState(scenario: MockScenarioName): MockPersistedState {
    const definitionForScenario = SCENARIO_DEFINITIONS[scenario]
    const now = this.scheduler.now()
    const state: MockPersistedState = {
      namespace: MOCK_STATE_NAMESPACE,
      version: MOCK_STATE_VERSION,
      scenario,
      revision: 0,
      startedAt: now,
      session: null,
      refreshTokens: [],
      player: null,
      dailies: [],
      dailyHistory: [],
      ship: null,
      shipMissing: definitionForScenario.ship === 'missing',
      expeditions: [],
      currentExpeditionId: null,
      mutations: createEmptyMockMutations(),
    }

    if (definitionForScenario.authenticated) {
      const player = createPlayer()
      state.player = player
      const session = this.createSessionRecord(player.id)
      state.session = session.session
      state.refreshTokens = [session.record]
      if (definitionForScenario.expiredSession) {
        state.session = { ...session.session, accessTokenExpiresAt: now - 1_000 }
        session.record.consumed = true
      }
    }

    if (definitionForScenario.dailies === 'established') {
      state.dailies = createEstablishedDailies()
    }
    if (definitionForScenario.ship === 'healthy') {
      state.ship = createHealthyShip()
    } else if (definitionForScenario.ship === 'damaged') {
      state.ship = createDamagedShip()
    }
    if (definitionForScenario.history) {
      state.dailyHistory = createResolvedDailyHistory()
      state.expeditions = createResolvedExpeditionHistory()
    }
    if (definitionForScenario.currentExpedition === 'active') {
      const active = createActiveExpedition()
      state.expeditions = [active, ...state.expeditions]
      state.currentExpeditionId = active.id
    }
    return state
  }

  private issueSession(
    userId: string,
    familyId: string = `family-${FIXED_USER_ID}`,
  ): AuthSessionResponse {
    const session = this.createSessionRecord(userId, familyId)
    this.state.session = session.session
    // Retire the replaced token from the same family, then append the new one.
    this.state.refreshTokens = [
      ...this.state.refreshTokens.filter(
        (record) => record.familyId !== familyId || record.consumed,
      ),
      session.record,
    ]
    this.persist()
    return {
      user: this.state.player ?? createPlayer(),
      access_token: session.session.accessToken,
      refresh_token: session.record.token,
    }
  }

  private createSessionRecord(
    userId: string,
    familyId: string = `family-${FIXED_USER_ID}`,
  ): { session: NonNullable<MockPersistedState['session']>; record: MockRefreshTokenRecord } {
    const issuedAt = this.scheduler.now()
    const accessTokenExpiresAt = issuedAt + ACCESS_TOKEN_TTL_MS
    const familySuffix = familyId.slice(-6)
    this.tokenCounter += 1
    const token = `mock-refresh-${familySuffix}-${this.tokenCounter}`
    return {
      session: {
        userId,
        familyId,
        accessToken: createAccessToken(userId, issuedAt, accessTokenExpiresAt),
        accessTokenExpiresAt,
      },
      record: { token, familyId, userId, consumed: false },
    }
  }

  private invalidateFamily(familyId: string): void {
    this.state.refreshTokens = this.state.refreshTokens.filter(
      (record) => record.familyId !== familyId,
    )
    if (this.state.session?.familyId === familyId) {
      this.state.session = null
    }
    this.persist()
  }

  private requireSession(accessToken: string | undefined): void {
    if (this.definition.outage) {
      throw new MockApiError(503, 'AUTH_SERVICE_UNAVAILABLE', 'Authentication is unavailable.')
    }
    if (accessToken === undefined || accessToken === '') {
      throw new MockApiError(401, 'AUTH_MISSING_HEADER', 'A bearer token is required.')
    }
    const session = this.state.session
    if (
      session === null ||
      session.accessToken !== accessToken ||
      session.accessTokenExpiresAt <= this.scheduler.now()
    ) {
      throw new MockApiError(401, 'AUTH_INVALID_TOKEN', 'The access token is invalid or expired.')
    }
  }

  private guardDailyProvisioning(): void {
    if (!this.definition.provisioning) {
      return
    }
    if (this.scheduler.now() - this.state.startedAt < PROVISIONING_WINDOW_MS) {
      throw new MockApiError(
        503,
        'DAILY_PLAYER_NOT_READY',
        'Daily player state is still provisioning.',
      )
    }
  }

  private guardExpeditionReadiness(): void {
    if (!this.definition.provisioning) {
      return
    }
    if (this.scheduler.now() - this.state.startedAt < PROVISIONING_WINDOW_MS) {
      throw new MockApiError(
        503,
        'EXPEDITION_SHIP_STATE_NOT_READY',
        'Ship state is still provisioning.',
      )
    }
  }

  private guardOutage(service: 'user' | 'daily' | 'ship' | 'expedition'): void {
    if (!this.definition.outage) {
      return
    }
    const codes: Record<typeof service, [number, string]> = {
      user: [503, 'AUTH_SERVICE_UNAVAILABLE'],
      daily: [503, 'DAILY_PLAYER_NOT_READY'],
      ship: [500, 'INTERNAL_ERROR'],
      expedition: [503, 'EXPEDITION_SHIP_STATE_NOT_READY'],
    }
    const [status, code] = codes[service]
    throw new MockApiError(status, code, `${service} is temporarily unavailable.`)
  }

  private requireDaily(id: string): Daily {
    const daily = this.state.dailies.find((candidate) => candidate.id === id)
    if (daily === undefined) {
      throw new MockApiError(404, 'DAILY_NOT_FOUND', 'That Daily does not exist.')
    }
    return daily
  }

  private findCurrentExpedition(): Expedition | undefined {
    if (this.state.currentExpeditionId === null) {
      return undefined
    }
    return this.state.expeditions.find(
      (expedition) =>
        expedition.id === this.state.currentExpeditionId && expedition.status === 'IN_FLIGHT',
    )
  }

  /**
   * Applies the downstream effects that the configured propagation window has
   * made visible. Expedition deduction is also gated by
   * `permanentlyStaleReconciliation`, which models a consumer that never
   * catches up so the frontend must surface an explicit stale outcome.
   */
  private materialize(): void {
    const window = this.definition.propagationWindowMs
    const { mutations } = this.state
    const ship = this.state.ship
    if (ship === null) {
      return
    }
    if (
      mutations.dailyCompletedAt !== null &&
      this.scheduler.now() - mutations.dailyCompletedAt >= window
    ) {
      ship.materials_balance += mutations.dailyRewardMaterials
      mutations.dailyCompletedAt = null
      mutations.dailyRewardMaterials = 0
    }
    if (
      !this.definition.permanentlyStaleReconciliation &&
      mutations.expeditionLaunchedAt !== null &&
      this.scheduler.now() - mutations.expeditionLaunchedAt >= window
    ) {
      ship.materials_balance = Math.max(0, ship.materials_balance - mutations.expeditionDeduction)
      mutations.expeditionLaunchedAt = null
      mutations.expeditionDeduction = 0
    }
    ship.updated_at = new Date(this.scheduler.now()).toISOString()
  }

  private persist(): void {
    this.state.revision += 1
    this.store.save(this.state)
  }
}

function createAccessToken(userId: string, issuedAt: number, expiresAt: number): string {
  const header = base64UrlEncode({ alg: 'EdDSA', typ: 'JWT', kid: 'mock-key' })
  const payload = base64UrlEncode({
    sub: userId,
    iat: Math.floor(issuedAt / 1000),
    exp: Math.floor(expiresAt / 1000),
  })
  return `${header}.${payload}.mock-signature`
}

function base64UrlEncode(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
