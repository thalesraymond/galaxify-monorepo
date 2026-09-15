import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Daily, Difficulty } from '@/api/generated/daily/types.gen'
import { isApiHttpError, type ApiTransport } from '@/api/transport'

import { completeDaily, dailiesQueryKey, type DailyListFilters } from '../api/dailyApi'
import { probeShipBalance, SHIP_BALANCE_QUERY_KEY } from '../api/shipProbe'
import type { DifficultyRewards } from '../lib/difficulties'
import { requestFailureMessage } from '../lib/message'

/**
 * Bounded reconciliation schedule after Daily completion
 * (web-frontend.md §3.4): reconcile immediately, then at approximately
 * 1, 2, 4, and 8 seconds (measured from completion) while the tab is visible
 * and online.
 */
const PROBE_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000] as const

/** Delay from the previous probe to the next schedule milestone. */
function nextProbeDelay(index: number): number | undefined {
  const absolute = PROBE_SCHEDULE_MS[index]
  if (absolute === undefined) {
    return undefined
  }
  const previous = index === 0 ? 0 : (PROBE_SCHEDULE_MS[index - 1] ?? 0)
  return absolute - previous
}

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
 * One probe session per Daily id, so completing several Dailies reconciles
 * independently: a second completion never steals the first row's schedule.
 */
type ProbeSession = {
  readonly dailyId: string
  baseline: number | undefined
  observed: number | undefined
  expectedAward: number
  nextProbeIndex: number
  timer: number | undefined
  generation: number
  done: boolean
}

function isReconciliationPaused(): boolean {
  return document.visibilityState === 'hidden' || !navigator.onLine
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
 * on failure, settle as completed on DAILY_ALREADY_COMPLETED, and probe the
 * Ship balance afterwards.
 */
export function useDailyCompletion(
  transport: ApiTransport,
  filters: DailyListFilters,
  difficulties: ReadonlyMap<Difficulty, DifficultyRewards>,
) {
  const queryClient = useQueryClient()
  const [failures, setFailures] = useState<ReadonlyMap<string, CompletionFailure>>(new Map())
  const [reconciliations, setReconciliations] = useState<ReadonlyMap<string, ReconciliationState>>(
    new Map(),
  )

  const sessionsRef = useRef(new Map<string, ProbeSession>())
  const generationRef = useRef(0)
  // The probe loop re-schedules itself; the ref keeps the recursive call on the
  // latest callback without a forward reference (react-hooks/refs).
  const runProbeRef = useRef<(session: ProbeSession) => Promise<void>>(async () => {})

  const updateReconciliation = useCallback((dailyId: string, state: ReconciliationState): void => {
    setReconciliations((previous) => {
      const next = new Map(previous)
      next.set(dailyId, state)
      return next
    })
  }, [])

  /**
   * Probes the Ship balance once, then schedules the next probe from the
   * bounded 1/2/4/8s schedule. The first probe (nextProbeIndex 0) establishes
   * the baseline; a later probe that observes the expected award lands marks
   * the reconciliation ready; exhausting the schedule marks `delayed`.
   */
  const runProbe = useCallback(
    async (session: ProbeSession): Promise<void> => {
      const generation = session.generation
      let balance: number | undefined
      try {
        balance = await probeShipBalance(transport)
      } catch {
        balance = undefined
      }
      const current = sessionsRef.current.get(session.dailyId)
      if (generation !== session.generation || current !== session) {
        return
      }
      session.observed = balance
      const baseline = session.baseline
      if (
        session.nextProbeIndex > 0 &&
        session.expectedAward > 0 &&
        baseline !== undefined &&
        balance !== undefined &&
        balance - baseline >= session.expectedAward
      ) {
        // The authoritative Ship balance moved by the expected award.
        session.done = true
        updateReconciliation(session.dailyId, {
          phase: 'ready',
          baseline,
          observed: balance,
          expectedAward: session.expectedAward,
        })
        return
      }
      if (session.baseline === undefined && balance !== undefined) {
        session.baseline = balance
      }
      updateReconciliation(session.dailyId, {
        phase: 'probing',
        baseline: session.baseline,
        observed: balance,
        expectedAward: session.expectedAward,
      })
      if (isReconciliationPaused()) {
        return
      }
      const delay = nextProbeDelay(session.nextProbeIndex)
      if (delay === undefined) {
        session.done = true
        updateReconciliation(session.dailyId, {
          phase: 'delayed',
          baseline: session.baseline,
          observed: session.observed,
          expectedAward: session.expectedAward,
        })
        return
      }
      session.nextProbeIndex += 1
      session.timer = window.setTimeout(() => {
        session.timer = undefined
        void runProbeRef.current(session)
      }, delay)
    },
    [transport, updateReconciliation],
  )

  useEffect(() => {
    runProbeRef.current = runProbe
  }, [runProbe])

  const startReconciliation = useCallback(
    (dailyId: string, expectedAward: number): void => {
      const previous = sessionsRef.current.get(dailyId)
      if (previous !== undefined && previous.timer !== undefined) {
        window.clearTimeout(previous.timer)
      }
      const session: ProbeSession = {
        dailyId,
        baseline: undefined,
        observed: undefined,
        expectedAward,
        nextProbeIndex: 0,
        timer: undefined,
        generation: (generationRef.current += 1),
        done: false,
      }
      sessionsRef.current.set(dailyId, session)
      updateReconciliation(dailyId, {
        phase: 'probing',
        baseline: undefined,
        observed: undefined,
        expectedAward,
      })
      void runProbe(session)
    },
    [updateReconciliation, runProbe],
  )

  const pauseSessions = useCallback((): void => {
    for (const session of sessionsRef.current.values()) {
      if (session.timer !== undefined) {
        window.clearTimeout(session.timer)
        session.timer = undefined
      }
    }
  }, [])

  const resumeSessions = useCallback((): void => {
    if (isReconciliationPaused()) {
      return
    }
    for (const session of sessionsRef.current.values()) {
      if (!session.done && session.timer === undefined) {
        void runProbe(session)
      }
    }
  }, [runProbe])

  // Pause reconciliation while the tab is hidden or offline (spec §3.2);
  // resume the remaining probe schedules on visibility or connectivity.
  useEffect(() => {
    const sessions = sessionsRef.current
    const handleVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        pauseSessions()
      } else {
        resumeSessions()
      }
    }
    const handleOffline = (): void => {
      pauseSessions()
    }
    const handleOnline = (): void => {
      resumeSessions()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      for (const session of sessions.values()) {
        if (session.timer !== undefined) {
          window.clearTimeout(session.timer)
        }
      }
      generationRef.current += 1
      sessions.clear()
    }
  }, [pauseSessions, resumeSessions])

  const completeMutation = useMutation({
    mutationFn: ({ dailyId }: { readonly dailyId: string; readonly difficulty: Difficulty }) =>
      completeDaily(transport, dailyId),
    onMutate: async ({ dailyId }) => {
      // Completion is the only optimistic domain mutation: mark the row
      // COMPLETED and disable its control immediately (spec §3.3). Under the
      // PENDING filter the completed row belongs in the (hidden) completed
      // section, so it leaves the visible pending list at once.
      await queryClient.cancelQueries({ queryKey: dailiesQueryKey(filters) })
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
      return { previous }
    },
    onError: (error, variables, context) => {
      const previous = context?.previous
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
        startReconciliation(variables.dailyId, expectedAward)
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
    onSuccess: (completed) => {
      setFailures((previousFailures) => {
        const next = new Map(previousFailures)
        next.delete(completed.id)
        return next
      })
      // The accepting service is authoritative: refresh the decoded list and
      // invalidate the known dependent (Ship balance), then reconcile (§3.4).
      void queryClient.invalidateQueries({ queryKey: dailiesQueryKey(filters) })
      void queryClient.invalidateQueries({ queryKey: SHIP_BALANCE_QUERY_KEY })
      startReconciliation(completed.id, completed.awarded_materials)
    },
  })

  const complete = useCallback(
    (dailyId: string, difficulty: Difficulty): void => {
      completeMutation.mutate({ dailyId, difficulty })
    },
    [completeMutation],
  )

  const retryReconciliation = useCallback(
    (dailyId: string): void => {
      const session = sessionsRef.current.get(dailyId)
      if (session === undefined) {
        return
      }
      startReconciliation(dailyId, session.expectedAward)
    },
    [startReconciliation],
  )

  return {
    complete,
    completingDailyId: completeMutation.isPending ? completeMutation.variables.dailyId : undefined,
    failures,
    reconciliations,
    retryReconciliation,
  }
}
