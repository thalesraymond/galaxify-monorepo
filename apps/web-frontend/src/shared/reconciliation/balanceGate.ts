import { onClearDownstreamObservations } from './downstreamReconciliation'

const keys = new Set<string>()
const listeners = new Set<() => void>()
let snapshot: readonly string[] = []

function publish(): void {
  snapshot = [...keys]
  for (const listener of [...listeners]) listener()
}

export function registerBalanceGateKey(key: string): void {
  if (keys.has(key)) return
  keys.add(key)
  publish()
}

export function unregisterBalanceGateKey(key: string): void {
  if (keys.delete(key)) publish()
}

export function subscribeToBalanceGateKeys(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getBalanceGateKeys(): readonly string[] {
  return snapshot
}

onClearDownstreamObservations(() => {
  if (keys.size === 0) return
  keys.clear()
  publish()
})
