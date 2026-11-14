import type { QueryClient } from '@tanstack/react-query'

import type { ApiTransport } from '@/api/transport'
import { getShip, observeShip, shipQueryKey, type ShipState } from '@/features/ship'
import {
  downstreamReconciliation,
  registerDownstreamObservation,
  useDownstreamExpectations,
  type DownstreamExpectation,
} from '@/shared/reconciliation'

export const DAILY_AWARD_SCOPE = 'daily:award'

/**
 * One expected change per Daily: the typed material award its completion
 * hands to the Ship. The identity is stable, so a route change or a local
 * Retry reuses the same pending round instead of starting a new one.
 */
export function dailyAwardObservationKey(dailyId: string): string {
  return `daily:${dailyId}:award`
}

type DailyAwardMeta = {
  /** The confirmed Ship balance captured before the completion was submitted. */
  readonly baseline: number | undefined
  /** The balance seen by the last fresh Ship observation. */
  readonly observed: number | undefined
  readonly expectedAward: number
}

/** What one Daily's expected award looks like right now. */
export type DailyAwardExpectation = DownstreamExpectation<DailyAwardMeta>

/** Subscribes to expectation changes (registration, fresh facts, phase). */
export function subscribeToDailyAwardExpectations(listener: () => void): () => void {
  return downstreamReconciliation.subscribeExpectations(DAILY_AWARD_SCOPE, listener)
}

/** The current expectations, keyed by Daily id. */
export function getDailyAwardExpectations(): ReadonlyMap<string, DailyAwardExpectation> {
  return downstreamReconciliation.getExpectations<DailyAwardMeta>(DAILY_AWARD_SCOPE)
}

/** React hook subscribing to session-owned Daily award expectations. */
export function useDailyAwardExpectations(): ReadonlyMap<string, DailyAwardExpectation> {
  return useDownstreamExpectations<DailyAwardMeta>(DAILY_AWARD_SCOPE)
}

/**
 * Keeps the shared Ship cache warm for the Daily surfaces. A completion can
 * only capture its pre-command baseline from a confirmed Ship balance, and the
 * Daily rows render Ship facts, so the feature confirms the balance in the
 * background. This read never blocks the Player's command: a completion that
 * finds no confirmed balance simply has no baseline.
 */
export function confirmShipBalance(queryClient: QueryClient, transport: ApiTransport): void {
  void queryClient
    .query({
      queryKey: shipQueryKey,
      queryFn: ({ signal }) => getShip(transport, signal),
    })
    .catch(() => {
      // A failed confirmation leaves the balance unknown: a completion then
      // has no baseline and never claims an observed award.
    })
}

/**
 * Registers the expected award of an accepted Daily completion.
 *
 * The `baseline` is the last confirmed Ship balance the browser held *before*
 * the completion was submitted: an award that was already applied when the
 * first fresh read arrives must never be mistaken for the starting balance.
 * Without a baseline the observation still refreshes and publishes facts, but
 * it never claims the award was observed.
 *
 * A Daily id is a stable recurring definition: the same Daily can be
 * completed again later in the session. A completion while a round is still
 * in flight is ignored (that round keeps its budget, baseline, and award),
 * while a completion after the round settled or expired replaces the
 * expectation and restarts the bounded budget with the new numbers.
 */
export function registerDailyAwardObservation(
  dailyId: string,
  expectedAward: number,
  baseline: number | undefined,
  queryClient: QueryClient,
  transport: ApiTransport,
): void {
  registerDownstreamObservation<ShipState, DailyAwardMeta>({
    key: dailyAwardObservationKey(dailyId),
    id: dailyId,
    scope: DAILY_AWARD_SCOPE,
    gatesBalance: true,
    onConflict: 'replace-when-settled',
    meta: {
      baseline,
      observed: undefined,
      expectedAward,
    },
    read: (signal) => observeShip(queryClient, transport, signal),
    publish: (ship, meta) => {
      // Publish fresh Ship facts to the shared cache so every view renders the
      // same observed facts, and record `observed` in session metadata before
      // satisfaction is evaluated.
      queryClient.setQueryData<ShipState>(shipQueryKey, ship)
      const observed = ship.kind === 'ready' ? ship.ship.materials_balance : undefined
      return observed !== meta.observed ? { ...meta, observed } : undefined
    },
    isSatisfied: (ship, meta) => satisfiesExpectation(ship, meta),
  })
}

/**
 * The expected award is satisfied by an aggregate balance change, not by proof
 * that this Daily's own event was consumed: overlapping awards and spending
 * can satisfy it, and a spending change can delay it.
 */
function satisfiesExpectation(ship: ShipState, meta: DailyAwardMeta): boolean {
  if (meta.baseline === undefined || ship.kind !== 'ready') {
    return false
  }
  return ship.ship.materials_balance - meta.baseline >= meta.expectedAward
}
