import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import type { Daily, Difficulty } from '@/api/generated/daily/types.gen'
import { isApiHttpError, type ApiTransport } from '@/api/transport'
import { shipQueryKey, type ShipState } from '@/features/ship'
import {
  downstreamReconciliation,
  getDownstreamSessionGeneration,
  type DownstreamObservationPhase,
} from '@/shared/reconciliation'

import { completeDaily, dailiesQueryKey, type DailyListFilters } from '../api/dailyApi'
import {
  dailyAwardObservationKey,
  getDailyAwardExpectations,
  registerDailyAwardObservation,
  subscribeToDailyAwardExpectations,
} from '../lib/dailyAwardObservation'
import type { DifficultyRewards } from '../lib/difficulties'
import { requestFailureMessage } from '../lib/message'

export type CompletionFailure = {
  readonly dailyId: string
  readonly difficulty: Difficulty
  readonly message: string
}

/**
 * Per-completion Ship reconciliation state. Pending Dailies stay on the page;
 * the affected value is the Ship materials balance shown on the completed row.
 */
export type ReconciliationState = {
  readonly phase: 'probing' | 'ready' | 'delayed'
  readonly baseline: number | undefined
  readonly observed: number | undefined
  readonly expectedAward: number
}

/**
 * The shared module's phases map onto the row's reconciliation language: an
 * updating round is still probing, an expired round is delayed, and a retired
 * round (the expected award was observed) is ready.
 */
function reconciliationPhase(phase: DownstreamObservationPhase): ReconciliationState['phase'] {
  switch (phase) {
    case 'updating':
      return 'probing'
    case 'delayed':
      return 'delayed'
    case 'idle':
      return 'ready'
  }
}

/**
 * The last confirmed Ship balance the browser held. It is the pre-command
 * baseline: an award that was already applied when the first fresh read
 * arrives must never be mistaken for the starting balance.
 */
function captureShipBaseline(queryClient: QueryClient): number | undefined {
  const state = queryClient.getQueryData<ShipState>(shipQueryKey)
  return state?.kind === 'ready' ? state.ship.materials_balance : undefined
}

/**
 * Restores only the affected row from the pre-mutation snapshot, preserving
 * any concurrent list state (other optimistic completions, sorted rows).
 * Handles both the marked-completed and the removed-under-filter cases.
 */
function restoreCompletedRow(
  current: Daily[] | undefined,
  previous: readonly Daily[],
  dailyId: string,
): Daily[] | undefined {
  if (current === undefined) {
    return current
  }
  const original = previous.find((daily) => daily.id === dailyId)
  if (original === undefined) {
    return current
  }
  const index = current.findIndex((daily) => daily.id === dailyId)
  if (index !== -1) {
    return current.map((daily) => (daily.id === dailyId ? original : daily))
  }
  const previousIndex = Math.max(
    0,
    previous.findIndex((daily) => daily.id === dailyId),
  )
  const next = [...current]
  next.splice(Math.min(previousIndex, next.length), 0, original)
  return next
}

/**
 * Owns completion as the only optimistic domain mutation (§3.3) plus the
 * bounded Ship reconciliation (§3.4): mark COMPLETED immediately (or remove
 * the row under the PENDING filter), restore in place with a row-level Retry
 * on failure, settle as completed on DAILY_ALREADY_COMPLETED, and observe the
 * Ship balance afterwards.
 *
 * The reconciliation itself belongs to the shared Downstream Reconciliation
 * module: this hook contributes the pre-command baseline and the typed award,
 * and renders the session-owned expectation the module reports back.
 */
export function useDailyCompletion(
  transport: ApiTransport,
  filters: DailyListFilters,
  difficulties: ReadonlyMap<Difficulty, DifficultyRewards>,
) {
  const queryClient = useQueryClient()
  const [failures, setFailures] = useState<ReadonlyMap<string, CompletionFailure>>(new Map())

  const expectations = useSyncExternalStore(
    subscribeToDailyAwardExpectations,
    getDailyAwardExpectations,
    getDailyAwardExpectations,
  )

  const reconciliations = useMemo(() => {
    const next = new Map<string, ReconciliationState>()
    for (const [dailyId, expectation] of expectations) {
      next.set(dailyId, {
        phase: reconciliationPhase(expectation.phase),
        baseline: expectation.baseline,
        observed: expectation.observed,
        expectedAward: expectation.expectedAward,
      })
    }
    return next
  }, [expectations])

  const completeMutation = useMutation({
    mutationFn: ({
      dailyId,
    }: {
      readonly dailyId: string
      readonly difficulty: Difficulty
      readonly sessionGeneration: number
    }) => completeDaily(transport, dailyId),
    onMutate: async ({ dailyId, sessionGeneration }) => {
      // The baseline is read synchronously from the confirmed Ship cache, so
      // the Player's command is never delayed to obtain it.
      const baseline = captureShipBaseline(queryClient)
      // Completion is the only optimistic domain mutation: mark the row
      // COMPLETED and disable its control immediately (spec §3.3). Under the
      // PENDING filter the completed row belongs in the (hidden) completed
      // section, so it leaves the visible pending list at once.
      await queryClient.cancelQueries({ queryKey: dailiesQueryKey(filters) })
      if (sessionGeneration !== getDownstreamSessionGeneration())
        return { previous: undefined, baseline, sessionGeneration }
      const previous = queryClient.getQueryData<Daily[]>(dailiesQueryKey(filters))
      queryClient.setQueryData<Daily[]>(dailiesQueryKey(filters), (current) => {
        if (current === undefined) {
          return current
        }
        if (filters.status === 'PENDING') {
          return current.filter((daily) => daily.id !== dailyId)
        }
        return current.map((daily) =>
          daily.id === dailyId ? { ...daily, status: 'COMPLETED' as const } : daily,
        )
      })
      return { previous, baseline, sessionGeneration }
    },
    onError: (error, variables, context) => {
      if (context?.sessionGeneration !== getDownstreamSessionGeneration()) return
      const previous = context.previous
      if (previous !== undefined) {
        queryClient.setQueryData<Daily[]>(dailiesQueryKey(filters), (current) =>
          restoreCompletedRow(current, previous, variables.dailyId),
        )
      }
      if (isApiHttpError(error, 'DAILY_ALREADY_COMPLETED')) {
        // Roll back, then let the authoritative refetch settle the row as
        // completed (spec §3.3), and reconcile the Ship as if this tab had won.
        void queryClient.invalidateQueries({ queryKey: dailiesQueryKey(filters) })
        const expectedAward = difficulties.get(variables.difficulty)?.reward ?? 0
        registerDailyAwardObservation(
          variables.dailyId,
          expectedAward,
          context.baseline,
          queryClient,
          transport,
        )
        return
      }
      setFailures((previousFailures) => {
        const next = new Map(previousFailures)
        next.set(variables.dailyId, {
          dailyId: variables.dailyId,
          difficulty: variables.difficulty,
          message: requestFailureMessage(error, 'The Daily could not be completed.'),
        })
        return next
      })
    },
    onSuccess: (completed, _variables, context) => {
      if (context.sessionGeneration !== getDownstreamSessionGeneration()) return
      setFailures((previousFailures) => {
        const next = new Map(previousFailures)
        next.delete(completed.id)
        return next
      })
      // Refresh the authoritative list; each reconciliation observation also
      // refreshes the shared Ship cache through its owning feature (§3.4).
      void queryClient.invalidateQueries({ queryKey: dailiesQueryKey(filters) })
      registerDailyAwardObservation(
        completed.id,
        completed.awarded_materials,
        context.baseline,
        queryClient,
        transport,
      )
    },
  })

  const complete = useCallback(
    (dailyId: string, difficulty: Difficulty): void => {
      completeMutation.mutate({
        dailyId,
        difficulty,
        sessionGeneration: getDownstreamSessionGeneration(),
      })
    },
    [completeMutation],
  )

  const retryReconciliation = useCallback((dailyId: string): void => {
    // A local Retry restarts the observation budget only: the shared round
    // keeps its baseline and typed award expectation.
    downstreamReconciliation.retry(dailyAwardObservationKey(dailyId))
  }, [])

  return {
    complete,
    completingDailyId: completeMutation.isPending ? completeMutation.variables.dailyId : undefined,
    failures,
    reconciliations,
    retryReconciliation,
  }
}
