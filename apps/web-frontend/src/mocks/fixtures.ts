import type { Daily, DailyDifficulty, DailyHistory } from '@/api/generated/daily/types.gen'
import type { Expedition, ExpeditionQuote } from '@/api/generated/expedition/types.gen'
import type { Ship } from '@/api/generated/ship/types.gen'
import type { UserResponse } from '@/api/generated/user/types.gen'

/**
 * Fixed clock epoch for every mock fixture. Nothing here reads the wall clock,
 * so scenarios are identical across runs, reloads, and tabs.
 */
export const FIXED_MOCK_EPOCH_MS = Date.UTC(2026, 0, 15, 9, 0, 0)

export const FIXED_MOCK_NOW_ISO = new Date(FIXED_MOCK_EPOCH_MS).toISOString()

export const FIXED_USER_ID = '1f8fad5b-d9cb-469f-a165-70867728950e'
export const FIXED_OTHER_USER_ID = '2f8fad5b-d9cb-469f-a165-70867728950e'

/**
 * Deterministic UUIDs. Generated Zod contracts type wire IDs as UUIDs, so mock
 * fixtures must be real UUIDs rather than readable slugs.
 */
export function fixedUuid(group: number, index: number): string {
  return `${String(group).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`
}

export const FIXED_DAILY_IDS = {
  calibrate: fixedUuid(1, 1),
  hydrate: fixedUuid(1, 2),
  stretch: fixedUuid(1, 3),
} as const

export const FIXED_EXPEDITION_IDS = {
  active: fixedUuid(2, 1),
  resolvedSuccess: fixedUuid(2, 2),
  resolvedFailure: fixedUuid(2, 3),
} as const

export const FIXED_DIFFICULTY_METADATA: readonly DailyDifficulty[] = [
  { difficulty: 'EASY', reward_materials: 10, damage_amount: 5 },
  { difficulty: 'MEDIUM', reward_materials: 25, damage_amount: 15 },
  { difficulty: 'HARD', reward_materials: 50, damage_amount: 30 },
]

function isoAt(offsetMs: number): string {
  return new Date(FIXED_MOCK_EPOCH_MS + offsetMs).toISOString()
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** A valid Player. `created_at` predates the fixed epoch by 30 days. */
export function createPlayer(overrides: Partial<UserResponse> = {}): UserResponse {
  return {
    id: FIXED_USER_ID,
    email: 'captain@galaxify.test',
    username: 'captain-logs',
    created_at: isoAt(-30 * DAY),
    updated_at: FIXED_MOCK_NOW_ISO,
    ...overrides,
  }
}

/** A valid recurring Daily due at the given offset from the fixed epoch. */
export function createDaily(
  id: string,
  overrides: Partial<Daily> & { readonly dueOffsetMs?: number } = {},
): Daily {
  const { dueOffsetMs = HOUR, ...dailyOverrides } = overrides
  const dueDate = isoAt(dueOffsetMs)
  return {
    id,
    user_id: FIXED_USER_ID,
    title: 'Calibrate sensors',
    description: 'Before the next jump',
    difficulty: 'EASY',
    due_date: dueDate,
    status: 'PENDING',
    created_at: isoAt(-2 * HOUR),
    updated_at: FIXED_MOCK_NOW_ISO,
    time_zone: 'UTC',
    due_local_date: dueDate.slice(0, 10),
    due_local_time: dueDate.slice(11, 16),
    ...dailyOverrides,
  }
}

/** The three current Dailies used by the default `established-player` fixture. */
export function createEstablishedDailies(): Daily[] {
  return [
    createDaily(FIXED_DAILY_IDS.calibrate, {
      title: 'Calibrate sensors',
      difficulty: 'EASY',
      dueOffsetMs: HOUR,
    }),
    createDaily(FIXED_DAILY_IDS.hydrate, {
      title: 'Hydrate the coolant loop',
      difficulty: 'MEDIUM',
      dueOffsetMs: 3 * HOUR,
      status: 'COMPLETED',
    }),
    createDaily(FIXED_DAILY_IDS.stretch, {
      title: 'Stretch the solar sails',
      description: 'A slow, deliberate pass over every panel',
      difficulty: 'HARD',
      dueOffsetMs: -2 * HOUR,
      status: 'PENDING',
    }),
  ]
}

/** An archived Daily outcome for Daily History. */
export function createDailyHistory(
  id: string,
  overrides: Partial<DailyHistory> & { readonly dueOffsetMs?: number } = {},
): DailyHistory {
  const { dueOffsetMs = -DAY, ...historyOverrides } = overrides
  const dueDate = isoAt(dueOffsetMs)
  return {
    id,
    daily_id: FIXED_DAILY_IDS.calibrate,
    user_id: FIXED_USER_ID,
    title: 'Calibrate sensors',
    description: 'Before the next jump',
    difficulty: 'EASY',
    due_date: dueDate,
    time_zone: 'UTC',
    due_local_date: dueDate.slice(0, 10),
    due_local_time: dueDate.slice(11, 16),
    status: 'COMPLETED',
    completed_at: isoAt(dueOffsetMs + 30 * 60 * 1000),
    missed_at: null,
    archived_at: isoAt(dueOffsetMs + 6 * HOUR),
    ...historyOverrides,
  }
}

export function createResolvedDailyHistory(): DailyHistory[] {
  return [
    createDailyHistory(fixedUuid(3, 1), { dueOffsetMs: -DAY }),
    createDailyHistory(fixedUuid(3, 2), {
      dueOffsetMs: -2 * DAY,
      status: 'MISSED',
      completed_at: null,
      missed_at: isoAt(-2 * DAY + 6 * HOUR),
    }),
  ]
}

/** A damaged but repairable Ship. */
export function createDamagedShip(overrides: Partial<Ship> = {}): Ship {
  return {
    user_id: FIXED_USER_ID,
    hull_health: 42,
    materials_balance: 120,
    level: 3,
    updated_at: FIXED_MOCK_NOW_ISO,
    ...overrides,
  }
}

/** A healthy Ship with enough materials to launch an Expedition. */
export function createHealthyShip(overrides: Partial<Ship> = {}): Ship {
  return createDamagedShip({ hull_health: 96, materials_balance: 250, ...overrides })
}

/**
 * An Expedition quote anchored to the fixed epoch. The default
 * `projected_balance` matches `createDamagedShip()` so probes reading a
 * freshly loaded Ship succeed.
 */
export function createExpeditionQuote(overrides: Partial<ExpeditionQuote> = {}): ExpeditionQuote {
  return {
    materials_invested: 0,
    normalized_investment: 0,
    projected_balance: 120,
    success_chance: 0,
    eligible: false,
    blocker: 'EXPEDITION_INSUFFICIENT_MATERIALS',
    cooldown_until: null,
    estimated_resolve_at: isoAt(HOUR),
    estimated_resolve_window_seconds: 3600,
    ...overrides,
  }
}

/**
 * An in-flight Expedition resolving one hour after the fixed epoch.
 * `success_chance` is a 0..1 fraction per the OpenAPI contract.
 */
export function createActiveExpedition(overrides: Partial<Expedition> = {}): Expedition {
  return {
    id: FIXED_EXPEDITION_IDS.active,
    user_id: FIXED_USER_ID,
    materials_invested: 40,
    success_chance: 0.62,
    resolve_at: isoAt(HOUR),
    status: 'IN_FLIGHT',
    created_at: isoAt(-30 * 60 * 1000),
    ...overrides,
  }
}

export function createResolvedExpedition(
  id: string,
  overrides: Partial<Expedition> & { readonly outcome?: 'SUCCESS' | 'FAILURE' } = {},
): Expedition {
  const { outcome = 'SUCCESS', ...expeditionOverrides } = overrides
  const resolvedAt = isoAt(-DAY)
  return {
    id,
    user_id: FIXED_USER_ID,
    materials_invested: 40,
    success_chance: 0.62,
    resolve_at: resolvedAt,
    status: 'RESOLVED',
    created_at: isoAt(-2 * DAY),
    resolved_at: resolvedAt,
    result: {
      id: fixedUuid(4, 1),
      expedition_id: id,
      outcome,
      material_reward: { materials: outcome === 'SUCCESS' ? 80 : 0 },
      created_at: resolvedAt,
    },
    ...expeditionOverrides,
  }
}

export function createResolvedExpeditionHistory(): Expedition[] {
  return [
    createResolvedExpedition(FIXED_EXPEDITION_IDS.resolvedSuccess, { outcome: 'SUCCESS' }),
    createResolvedExpedition(FIXED_EXPEDITION_IDS.resolvedFailure, {
      outcome: 'FAILURE',
      status: 'FAILED',
    }),
  ]
}
