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
 * on the Dailies route). The gate's one fresh read is session-owned: it keeps
 * running when its originating view unmounts, so another surface or a later
 * mount can use its result instead of starting a duplicate read.
 */
let handledExpiryGeneration = -1
let freshEpoch: number | undefined
let attemptedGeneration: number | undefined
let failedGeneration: number | undefined
let activeReadId = 0
let activeController: AbortController | undefined
let activeQueryClient: ReturnType<typeof useQueryClient> | undefined
let activeTimer: ReturnType<typeof setTimeout> | undefined
let stopActiveAvailability: (() => void) | undefined
let freshnessSnapshot = ''
const freshnessListeners = new Set<() => void>()

function freshnessKey(): string {
  return `${freshEpoch ?? ''}|${attemptedGeneration ?? ''}|${failedGeneration ?? ''}`
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

function canReadGate(): boolean {
  return document.visibilityState !== 'hidden' && navigator.onLine
}

function subscribeToAvailability(listener: () => void): () => void {
  const changed = (): void => {
    if (!canReadGate() && activeController !== undefined) {
      const client = activeQueryClient
      abortActiveRead()
      void client?.cancelQueries({ queryKey: shipQueryKey, exact: true })
      attemptedGeneration = undefined
      publishFreshness()
    }
    listener()
  }
  document.addEventListener('visibilitychange', changed)
  window.addEventListener('online', changed)
  window.addEventListener('offline', changed)
  return () => {
    document.removeEventListener('visibilitychange', changed)
    window.removeEventListener('online', changed)
    window.removeEventListener('offline', changed)
  }
}

function abortActiveRead(): void {
  activeReadId += 1
  stopActiveAvailability?.()
  stopActiveAvailability = undefined
  if (activeTimer !== undefined) {
    clearTimeout(activeTimer)
    activeTimer = undefined
  }
  activeController?.abort()
  activeController = undefined
  activeQueryClient = undefined
}

function resetAttempts(): void {
  abortActiveRead()
  freshEpoch = undefined
  attemptedGeneration = undefined
  failedGeneration = undefined
  publishFreshness()
}

function resetFreshness(): void {
  handledExpiryGeneration = -1
  resetAttempts()
}

function resetForGeneration(generation: number): void {
  if (generation === handledExpiryGeneration) return
  handledExpiryGeneration = generation
  resetAttempts()
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
  const available = useSyncExternalStore(subscribeToAvailability, canReadGate, canReadGate)

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

  // One automatic read per expiry generation, session-owned while it runs.
  useEffect(() => {
    if (hasFreshApproval) {
      if (activeController !== undefined) abortActiveRead()
      return
    }
    if (
      delayedSignature === '' ||
      updating ||
      expiryEpoch === undefined ||
      expiryGeneration === 0 ||
      !available ||
      attemptedGeneration === expiryGeneration
    ) {
      return
    }
    abortActiveRead()
    const readGeneration = expiryGeneration
    const readEpoch = expiryEpoch
    const readId = activeReadId + 1
    activeReadId = readId
    attemptedGeneration = readGeneration
    publishFreshness()
    const controller = new AbortController()
    activeController = controller
    activeQueryClient = queryClient
    stopActiveAvailability = subscribeToAvailability(() => {})
    activeTimer = setTimeout(() => {
      if (readId !== activeReadId) return
      activeReadId += 1
      activeController = undefined
      activeQueryClient = undefined
      activeTimer = undefined
      stopActiveAvailability?.()
      stopActiveAvailability = undefined
      controller.abort()
      failedGeneration = readGeneration
      publishFreshness()
    }, GATE_READ_TIMEOUT_MS)
    void observeShip(queryClient, transport, controller.signal)
      .then((result) => {
        if (readId !== activeReadId) return
        activeReadId += 1
        if (activeTimer !== undefined) {
          clearTimeout(activeTimer)
          activeTimer = undefined
        }
        activeController = undefined
        activeQueryClient = undefined
        stopActiveAvailability?.()
        stopActiveAvailability = undefined
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
        if (readId !== activeReadId) return
        activeReadId += 1
        if (activeTimer !== undefined) {
          clearTimeout(activeTimer)
          activeTimer = undefined
        }
        activeController = undefined
        activeQueryClient = undefined
        stopActiveAvailability?.()
        stopActiveAvailability = undefined
        if (getBalanceGateExpiry().generation !== readGeneration) return
        failedGeneration = readGeneration
        publishFreshness()
      })
  }, [
    delayedSignature,
    updating,
    expiryEpoch,
    expiryGeneration,
    hasFreshApproval,
    queryClient,
    transport,
    retryToken,
    available,
  ])

  const balance = ship.data?.kind === 'ready' ? ship.data.ship.materials_balance : undefined
  const retry = useCallback(() => {
    resetAttempts()
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
