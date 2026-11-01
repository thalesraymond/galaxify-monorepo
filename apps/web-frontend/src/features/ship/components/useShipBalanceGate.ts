import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useApiTransport } from '@/shared/api/TransportContext'
import {
  downstreamReconciliation,
  getBalanceGateKeys,
  onClearDownstreamObservations,
  subscribeToBalanceGateKeys,
} from '@/shared/reconciliation'
import { getShip, shipQueryKey } from '../api/shipApi'
import { observeShip } from '../api/shipQueries'

export type ShipBalanceGateState = 'open' | 'updating' | 'refreshing' | 'stale'

export type ShipBalanceGate = {
  readonly state: ShipBalanceGateState
  readonly reason: string
  readonly balance: number | undefined
  readonly retry: () => void
}

/** Bound the gate's own fresh read so `refreshing` cannot hang forever. */
const GATE_READ_TIMEOUT_MS = 5_000

/**
 * Expiry state is shared by every mounted gate surface. A successful fresh
 * read after the expiry epoch releases every view without a navigation
 * restarting the read, and a failed read stays failed until the player
 * retries. This is epoch bookkeeping, not a second observation scheduler.
 */
let expiryEpoch: number | undefined
let expirySignature: string | undefined
let freshEpoch: number | undefined
let attemptedEpoch: number | undefined
let failedEpoch: number | undefined
let freshnessSnapshot = ''
const freshnessListeners = new Set<() => void>()

function freshnessKey(): string {
  return `${expiryEpoch ?? ''}|${freshEpoch ?? ''}|${attemptedEpoch ?? ''}|${failedEpoch ?? ''}`
}

function publishFreshness(): void {
  const next = freshnessKey()
  if (next === freshnessSnapshot) return
  freshnessSnapshot = next
  for (const listener of [...freshnessListeners]) listener()
}

function subscribeToFreshness(listener: () => void): () => void {
  freshnessListeners.add(listener)
  return () => {
    freshnessListeners.delete(listener)
  }
}

function getFreshnessSnapshot(): string {
  return freshnessSnapshot
}

function resetFreshness(): void {
  expiryEpoch = undefined
  expirySignature = undefined
  freshEpoch = undefined
  attemptedEpoch = undefined
  failedEpoch = undefined
  publishFreshness()
}

onClearDownstreamObservations(resetFreshness)

/**
 * Narrow balance-dependent gate derived from the session's Daily award
 * observations. The hook subscribes as a visible observer to every registered
 * Daily key so a round can run and expire even when no Daily row is mounted.
 * While any round is updating, gated actions stay closed. After expiry the
 * gate opens only once an authoritative Ship read succeeds; a cached balance
 * from before the expiry is never treated as fresh confirmation.
 */
export function useShipBalanceGate(): ShipBalanceGate {
  const transport = useApiTransport()
  const queryClient = useQueryClient()
  const [retryToken, setRetryToken] = useState(0)
  const keys = useSyncExternalStore(
    subscribeToBalanceGateKeys,
    getBalanceGateKeys,
    getBalanceGateKeys,
  )
  const subscribeToPhases = useCallback(
    (listener: () => void) => {
      const detach = keys.map((key) => downstreamReconciliation.subscribe(key, listener))
      return () => {
        for (const stop of detach) stop()
      }
    },
    [keys],
  )
  const getPhaseSignature = useCallback(
    () => keys.map((key) => `${key}:${downstreamReconciliation.getPhase(key)}`).join('|'),
    [keys],
  )
  const phaseSignature = useSyncExternalStore(
    subscribeToPhases,
    getPhaseSignature,
    getPhaseSignature,
  )
  // Subscribes the render to the shared expiry/read bookkeeping.
  useSyncExternalStore(subscribeToFreshness, getFreshnessSnapshot, getFreshnessSnapshot)

  const ship = useQuery({
    queryKey: shipQueryKey,
    queryFn: ({ signal }) => getShip(transport, signal),
    enabled: false,
  })

  const phases = phaseSignature === '' ? [] : phaseSignature.split('|')
  const updating = phases.some((entry) => entry.endsWith(':updating'))
  const delayedSignature = phases
    .filter((entry) => entry.endsWith(':delayed'))
    .map((entry) => entry.slice(0, entry.lastIndexOf(':')))
    .join(',')

  // A new expiry set (or the last one clearing) starts a new freshness epoch.
  useEffect(() => {
    if (delayedSignature === '') {
      if (expiryEpoch !== undefined) resetFreshness()
      return
    }
    if (expirySignature === delayedSignature) return
    expirySignature = delayedSignature
    expiryEpoch = Date.now()
    freshEpoch = undefined
    attemptedEpoch = undefined
    failedEpoch = undefined
    publishFreshness()
  }, [delayedSignature])

  // Any successful authoritative Ship read after the epoch releases the gate.
  useEffect(() => {
    if (
      expiryEpoch === undefined ||
      ship.status !== 'success' ||
      ship.data.kind !== 'ready' ||
      ship.dataUpdatedAt <= expiryEpoch ||
      freshEpoch === ship.dataUpdatedAt
    ) {
      return
    }
    freshEpoch = ship.dataUpdatedAt
    failedEpoch = undefined
    publishFreshness()
  }, [ship.status, ship.data, ship.dataUpdatedAt])

  // One automatic read per expiry epoch, shared by every gate surface.
  useEffect(() => {
    if (
      delayedSignature === '' ||
      updating ||
      expiryEpoch === undefined ||
      freshEpoch !== undefined ||
      attemptedEpoch === expiryEpoch
    ) {
      return
    }
    const readEpoch = expiryEpoch
    attemptedEpoch = readEpoch
    publishFreshness()
    const controller = new AbortController()
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      controller.abort()
      failedEpoch = expiryEpoch
      publishFreshness()
    }, GATE_READ_TIMEOUT_MS)
    void observeShip(queryClient, transport, controller.signal)
      .then((result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (expiryEpoch !== readEpoch) return
        if (result.kind === 'ready') {
          // The read started after expiry even when the clock has millisecond resolution.
          freshEpoch = Math.max(Date.now(), readEpoch + 1)
          failedEpoch = undefined
        } else {
          failedEpoch = readEpoch
        }
        publishFreshness()
      })
      .catch(() => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        failedEpoch = expiryEpoch
        publishFreshness()
      })
    return () => {
      clearTimeout(timer)
      controller.abort()
      // An unmount/dependency change is not a failed read: let the next
      // mounted gate surface try once instead of stranding `refreshing`.
      if (!settled && freshEpoch === undefined) {
        attemptedEpoch = undefined
        publishFreshness()
      }
    }
  }, [delayedSignature, updating, queryClient, transport, retryToken])

  const balance = ship.data?.kind === 'ready' ? ship.data.ship.materials_balance : undefined
  const retry = useCallback(() => {
    attemptedEpoch = undefined
    failedEpoch = undefined
    freshEpoch = undefined
    publishFreshness()
    setRetryToken((value) => value + 1)
  }, [])

  if (updating) {
    return {
      state: 'updating',
      reason: 'The Ship balance is updating after a Daily completion.',
      balance,
      retry,
    }
  }
  if (delayedSignature === '') {
    return { state: 'open', reason: '', balance, retry }
  }
  if (ship.status === 'error' && freshEpoch !== undefined) {
    return {
      state: 'stale',
      reason: 'The Ship balance could not be refreshed. Retry before using it.',
      balance,
      retry,
    }
  }
  if (expiryEpoch !== undefined && freshEpoch !== undefined && freshEpoch > expiryEpoch) {
    return { state: 'open', reason: '', balance, retry }
  }
  if (failedEpoch === expiryEpoch) {
    return {
      state: 'stale',
      reason: 'The Ship balance could not be refreshed. Retry before using it.',
      balance,
      retry,
    }
  }
  return {
    state: 'refreshing',
    reason: 'Checking the current Ship balance.',
    balance,
    retry,
  }
}
