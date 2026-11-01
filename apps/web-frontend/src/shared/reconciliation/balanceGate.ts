import { onClearDownstreamObservations } from './downstreamReconciliation'

const keys = new Set<string>()
const listeners = new Set<() => void>()
const expiryListeners = new Set<() => void>()
let keysSnapshot: readonly string[] = []
let expiryEpoch: number | undefined
let expiryGeneration = 0
let expirySnapshot = '|0'

function publishKeys(): void {
  keysSnapshot = [...keys]
  for (const listener of [...listeners]) listener()
}

function publishExpiry(): void {
  const next = `${expiryEpoch ?? ''}|${expiryGeneration}`
  if (next === expirySnapshot) return
  expirySnapshot = next
  for (const listener of [...expiryListeners]) listener()
}

export function registerBalanceGateKey(key: string): void {
  if (keys.has(key)) return
  keys.add(key)
  publishKeys()
}

export function unregisterBalanceGateKey(key: string): void {
  if (!keys.delete(key)) return
  if (keys.size === 0) {
    // Generations stay monotonic until the session clears: a later expiry
    // must never reuse an approval from an earlier no-key interval.
    expiryEpoch = undefined
    publishExpiry()
  }
  publishKeys()
}

/**
 * Records that a Daily award round expired. Every transition to `delayed`
 * starts a new generation, even if the delayed key set is unchanged, so a
 * player-initiated retry cannot reuse a fresh read approved for the previous
 * round. Called by the Daily adapter, which stays subscribed to round phases
 * for the whole session, including while no gate surface is mounted.
 */
export function markBalanceGateExpired(): void {
  expiryEpoch = Date.now()
  expiryGeneration += 1
  publishExpiry()
}

export function subscribeToBalanceGateKeys(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getBalanceGateKeys(): readonly string[] {
  return keysSnapshot
}

export function subscribeToBalanceGateExpiry(listener: () => void): () => void {
  expiryListeners.add(listener)
  return () => {
    expiryListeners.delete(listener)
  }
}

/** Stable snapshot: `<epoch>|<generation>`. */
export function getBalanceGateExpirySnapshot(): string {
  return expirySnapshot
}

export function getBalanceGateExpiry(): {
  readonly epoch: number | undefined
  readonly generation: number
} {
  return { epoch: expiryEpoch, generation: expiryGeneration }
}

onClearDownstreamObservations(() => {
  const hadKeys = keys.size > 0
  const hadExpiry = expiryEpoch !== undefined || expiryGeneration !== 0
  keys.clear()
  expiryEpoch = undefined
  expiryGeneration = 0
  if (hadKeys) publishKeys()
  if (hadExpiry) publishExpiry()
})
