import type { DailyDifficulty, Difficulty } from '@/api/generated/daily/types.gen'

/** Backend-owned reward/missed-damage metadata for one difficulty tier. */
export type DifficultyRewards = {
  readonly reward: number
  readonly damage: number
}

/**
 * Feature-owned difficulty metadata mapping shared by the list, history, and
 * form surfaces. `GET /dailies/difficulties` is the single source of the
 * reward and missed-damage numbers (spec §5.3/§5.4).
 */
export function difficultyRewardsMap(
  metadata: readonly DailyDifficulty[] | undefined,
): ReadonlyMap<Difficulty, DifficultyRewards> {
  const map = new Map<Difficulty, DifficultyRewards>()
  for (const meta of metadata ?? []) {
    map.set(meta.difficulty, { reward: meta.reward_materials, damage: meta.damage_amount })
  }
  return map
}

/** Human tier label, e.g. "Medium", for chips and form options. */
export function difficultyLabel(difficulty: Difficulty): string {
  if (difficulty === 'EASY') {
    return 'Easy'
  }
  if (difficulty === 'MEDIUM') {
    return 'Medium'
  }
  return 'Hard'
}
