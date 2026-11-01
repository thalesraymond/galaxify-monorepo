import { useCallback, useSyncExternalStore } from 'react'

import {
  downstreamReconciliation,
  type DownstreamObservationPhase,
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
