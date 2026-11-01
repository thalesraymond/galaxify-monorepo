import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useApiTransport } from '@/shared/api/TransportContext'
import {
  downstreamReconciliation,
  getBalanceGateExpiry,
  getBalanceGateExpirySnapshot,
  getBalanceGateKeys,
  onClearDownstreamObservations,
  subscribeToBalanceGateExpiry,
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
 * Read/approval bookkeeping shared by every mounted gate surface. Expiry
 * generations live in the session registry because they must advance even
 * while no gate surface is mounted (for example, a Daily retry that expires
 * on the Dailies route). This module only coordinates which fresh read
 * belongs to which generation; it schedules nothing.
 */
let handledExpiryGeneration = -1
let freshEpoch: number | undefined
let attemptedGeneration: number | undefined
let failedGeneration: number | undefined
let readToken = 0
let freshnessSnapshot = ''
const freshnessListeners = new Set<() => void>()

function freshnessKey(): string {
  return `${freshEpoch ?? ''}|${attemptedGeneration ?? ''}|${failedGeneration ?? ''}|${readToken}`
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
  handledExpiryGeneration = -1
  freshEpoch = undefined
  attemptedGeneration = undefined
  failedGeneration = undefined
  readToken += 1
  publishFreshness()
}

function resetForGeneration(generation: number): void {
  if (generation === handledExpiryGeneration) return
  handledExpiryGeneration = generation
  freshEpoch = undefined
  attemptedGeneration = undefined
  failedGeneration = undefined
  publishFreshness()
}

onClearDownstreamObservations(resetFreshness)

function parseExpiry(snapshot: string): {
  readonly epoch: number | undefined
  readonly generation: number
} {
  const [epochText = '', generationText = '0'] = snapshot.split('|')
  return {
    epoch: epochText === '' ? undefined : Number(epochText),
    generation: Number(generationText),
  }
}

/**
 * Narrow balance-dependent gate derived from the session's Daily award
 * observations. The hook subscribes as a visible observer to every registered
 * Daily key so a round can run and expire even when no Daily row is mounted.
 * While any round is updating, gated actions stay closed. After expiry the
 * gate opens only once an authoritative Ship read succeeds for that expiry
 * generation; a cached balance from before the expiry is never fresh
 * confirmation.
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
  const expirySnapshot = useSyncExternalStore(
    subscribeToBalanceGateExpiry,
    getBalanceGateExpirySnapshot,
    getBalanceGateExpirySnapshot,
  )
  // Subscribes the render to the shared read/approval bookkeeping.
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
  const { epoch: expiryEpoch, generation: expiryGeneration } = parseExpiry(expirySnapshot)

  // A new expiry generation invalidates the previous approval and attempt.
  useEffect(() => {
    resetForGeneration(expiryGeneration)
  }, [expiryGeneration])

  // Any successful authoritative Ship read after the epoch releases the gate.
  useEffect(() => {
    if (
      expiryEpoch === undefined ||
      ship.status !== 'success' ||
      ship.data.kind !== 'ready' ||
      ship.dataUpdatedAt <= expiryEpoch ||
      (freshEpoch !== undefined && freshEpoch >= ship.dataUpdatedAt)
    ) {
      return
    }
    freshEpoch = ship.dataUpdatedAt
    failedGeneration = undefined
    publishFreshness()
  }, [expiryEpoch, ship.status, ship.data, ship.dataUpdatedAt])

  const hasFreshApproval =
    expiryEpoch !== undefined && freshEpoch !== undefined && freshEpoch > expiryEpoch

  // One automatic read per expiry generation, shared by every gate surface.
  useEffect(() => {
    if (
      delayedSignature === '' ||
      updating ||
      expiryEpoch === undefined ||
      expiryGeneration === 0 ||
      hasFreshApproval
    ) {
      return
    }
    if (attemptedGeneration === expiryGeneration) return
    const readGeneration = expiryGeneration
    const readEpoch = expiryEpoch
    attemptedGeneration = readGeneration
    publishFreshness()
    const controller = new AbortController()
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      controller.abort()
      if (getBalanceGateExpiry().generation !== readGeneration) return
      failedGeneration = readGeneration
      publishFreshness()
    }, GATE_READ_TIMEOUT_MS)
    void observeShip(queryClient, transport, controller.signal)
      .then((result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (getBalanceGateExpiry().generation !== readGeneration) return
        if (result.kind === 'ready') {
          // The read started after expiry even when the clock has millisecond
          // resolution.
          freshEpoch = Math.max(Date.now(), readEpoch + 1)
          failedGeneration = undefined
        } else {
          failedGeneration = readGeneration
        }
        publishFreshness()
      })
      .catch(() => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (getBalanceGateExpiry().generation !== readGeneration) return
        failedGeneration = readGeneration
        publishFreshness()
      })
    return () => {
      clearTimeout(timer)
      controller.abort()
      // An unmount is not a failed read: hand the attempt to another mounted
      // surface (readToken wakes its effect) or the next mount.
      if (!settled && getBalanceGateExpiry().generation === readGeneration) {
        attemptedGeneration = undefined
        readToken += 1
        publishFreshness()
      }
    }
  }, [
    delayedSignature,
    updating,
    expiryEpoch,
    expiryGeneration,
    hasFreshApproval,
    queryClient,
    transport,
    retryToken,
  ])

  const balance = ship.data?.kind === 'ready' ? ship.data.ship.materials_balance : undefined
  const retry = useCallback(() => {
    attemptedGeneration = undefined
    failedGeneration = undefined
    freshEpoch = undefined
    readToken += 1
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
  if (hasFreshApproval) {
    return { state: 'open', reason: '', balance, retry }
  }
  if (failedGeneration === expiryGeneration) {
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
