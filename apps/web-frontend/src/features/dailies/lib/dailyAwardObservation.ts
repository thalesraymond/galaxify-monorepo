import type { QueryClient } from '@tanstack/react-query'

import type { ApiTransport } from '@/api/transport'
import { getShip, observeShip, shipQueryKey, type ShipState } from '@/features/ship'
import {
  downstreamReconciliation,
  onClearDownstreamObservations,
  registerDownstreamObservation,
  type DownstreamObservationPhase,
} from '@/shared/reconciliation'

/**
 * One expected change per Daily: the typed material award its completion
 * hands to the Ship. The identity is stable, so a route change or a local
 * Retry reuses the same pending round instead of starting a new one.
 */
export function dailyAwardObservationKey(dailyId: string): string {
  return `daily:${dailyId}:award`
}

/** What one Daily's expected award looks like right now. */
export type DailyAwardExpectation = {
  readonly dailyId: string
  /** The shared module's phase for this Daily's expected award. */
  readonly phase: DownstreamObservationPhase
  /** The confirmed Ship balance captured before the completion was submitted. */
  readonly baseline: number | undefined
  /** The balance seen by the last fresh Ship observation. */
  readonly observed: number | undefined
  readonly expectedAward: number
}

/**
 * Session-owned expectations. The shared module owns the observation
 * lifecycle; this store owns what the Daily feature means by it (the
 * pre-command baseline and the typed award) and survives a route change
 * because the expectation belongs to the Player session, not to a view.
 */
const expectations = new Map<string, DailyAwardExpectation>()

/** Phase subscriptions, so the store learns when a round changes phase. */
const phaseSubscriptions = new Map<string, () => void>()

const listeners = new Set<() => void>()

/** Cached snapshot: `useSyncExternalStore` needs a stable identity. */
let snapshot: ReadonlyMap<string, DailyAwardExpectation> = new Map()

function publishSnapshot(): void {
  snapshot = new Map(expectations)
  for (const listener of [...listeners]) {
    listener()
  }
}

/** Subscribes to expectation changes (registration, fresh facts, phase). */
export function subscribeToDailyAwardExpectations(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The current expectations, keyed by Daily id. */
export function getDailyAwardExpectations(): ReadonlyMap<string, DailyAwardExpectation> {
  return snapshot
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
 * Registering a Daily whose round is still pending is a no-op: the pending
 * round keeps its budget, baseline, and award.
 */
export function registerDailyAwardObservation(
  dailyId: string,
  expectedAward: number,
  baseline: number | undefined,
  queryClient: QueryClient,
  transport: ApiTransport,
): void {
  const key = dailyAwardObservationKey(dailyId)
  if (downstreamReconciliation.getPhase(key) !== 'idle') {
    return
  }
  subscribeToPhases(dailyId)
  expectations.set(dailyId, {
    dailyId,
    phase: 'updating',
    baseline,
    observed: undefined,
    expectedAward,
  })
  publishSnapshot()
  registerDownstreamObservation({
    key,
    read: (signal) => observeShip(queryClient, transport, signal),
    isSatisfied: (ship) => satisfiesExpectation(dailyId, ship),
    publish: (ship) => {
      publishObservation(dailyId, ship, queryClient)
    },
  })
}

/**
 * Drops every expectation. The Player session owns these records: logout, an
 * account change, or disposal must not leave a Daily looking reconciled.
 */
export function clearDailyAwardExpectations(): void {
  for (const detach of phaseSubscriptions.values()) {
    detach()
  }
  phaseSubscriptions.clear()
  if (expectations.size === 0) {
    return
  }
  expectations.clear()
  publishSnapshot()
}

/**
 * The expected award is satisfied by an aggregate balance change, not by proof
 * that this Daily's own event was consumed: overlapping awards and spending
 * can satisfy it, and a spending change can delay it.
 */
function satisfiesExpectation(dailyId: string, ship: ShipState): boolean {
  const expectation = expectations.get(dailyId)
  if (expectation === undefined || expectation.baseline === undefined) {
    return false
  }
  if (ship.kind !== 'ready') {
    return false
  }
  return ship.ship.materials_balance - expectation.baseline >= expectation.expectedAward
}

/**
 * Publishes the fresh Ship facts to the shared Ship query, so every view
 * renders the same observed facts instead of a row-local balance.
 */
function publishObservation(dailyId: string, ship: ShipState, queryClient: QueryClient): void {
  const expectation = expectations.get(dailyId)
  if (expectation !== undefined) {
    expectations.set(dailyId, {
      ...expectation,
      observed: ship.kind === 'ready' ? ship.ship.materials_balance : undefined,
    })
    publishSnapshot()
  }
  queryClient.setQueryData<ShipState>(shipQueryKey, ship)
}

/** Follows the shared module's phase for one Daily's expected award. */
function subscribeToPhases(dailyId: string): void {
  const key = dailyAwardObservationKey(dailyId)
  const previous = phaseSubscriptions.get(dailyId)
  if (previous !== undefined) {
    previous()
  }
  const detach = downstreamReconciliation.subscribe(key, () => {
    notifyPhase(dailyId)
  })
  phaseSubscriptions.set(dailyId, detach)
}

function notifyPhase(dailyId: string): void {
  const phase = downstreamReconciliation.getPhase(dailyAwardObservationKey(dailyId))
  const expectation = expectations.get(dailyId)
  if (expectation === undefined || expectation.phase === phase) {
    return
  }
  expectations.set(dailyId, { ...expectation, phase })
  publishSnapshot()
}

// The session boundary clears the module's rounds and this store together, so
// no expectation outlives the Player session that created it.
onClearDownstreamObservations(clearDailyAwardExpectations)
