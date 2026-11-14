import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import {
  captureDownstreamSession,
  downstreamReconciliation,
  type BalanceGateInput,
  type BalanceGateView,
  type DownstreamExpectation,
  type DownstreamObservationPhase,
  type SessionGuard,
} from './downstreamReconciliation'

export type DownstreamObservationView = {
  readonly phase: DownstreamObservationPhase
  readonly retry: () => void
}

/**
 * Observes one expected change while this component is a visible observer of
 * the affected resource (`active`). Subscribing pauses/resumes reads without
 * touching the pending round; `retry` is the player-initiated budget restart
 * shown by `Update delayed`.
 */
export function useDownstreamObservation(key: string, active: boolean): DownstreamObservationView {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!active) {
        return () => {}
      }
      return downstreamReconciliation.subscribe(key, onStoreChange)
    },
    [key, active],
  )
  const getSnapshot = useCallback(() => downstreamReconciliation.getPhase(key), [key])
  const phase = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const retry = useCallback(() => {
    downstreamReconciliation.retry(key)
  }, [key])
  return { phase, retry }
}

/** Subscribes to the session-owned expectations registered under `scope`. */
export function useDownstreamExpectations<Meta = Record<string, unknown>>(
  scope: string,
): ReadonlyMap<string, DownstreamExpectation<Meta>> {
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      downstreamReconciliation.subscribeExpectations(scope, onStoreChange),
    [scope],
  )
  const getSnapshot = useCallback(
    () => downstreamReconciliation.getExpectations<Meta>(scope),
    [scope],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Subscribes a balance-spending action surface to the session Balance Gate
 * state machine and runs the bounded approval read after observation expiry.
 */
export function useBalanceGate(input: BalanceGateInput): BalanceGateView {
  const { read, confirmedAt, hasRefreshError } = input
  const getSnapshot = useCallback(
    () =>
      downstreamReconciliation.getBalanceGateState({
        read,
        confirmedAt,
        hasRefreshError,
      }),
    [read, confirmedAt, hasRefreshError],
  )
  const subscribe = useCallback(
    (onStoreChange: () => void) => downstreamReconciliation.subscribeBalanceGate(onStoreChange),
    [],
  )
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    downstreamReconciliation.syncBalanceGate({
      read,
      confirmedAt,
      hasRefreshError,
    })
  }, [state, read, confirmedAt, hasRefreshError])

  const retry = useCallback(() => {
    downstreamReconciliation.retryBalanceGate(read)
  }, [read])

  return useMemo(() => ({ state, retry }), [state, retry])
}

/** Captures the active session guard for this mounted component instance. */
export function useDownstreamSession(): SessionGuard {
  const [session] = useState(captureDownstreamSession)
  return session
}
