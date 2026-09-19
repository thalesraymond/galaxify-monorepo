import { useEffect, useState } from 'react'

import type { ApiTransport } from '@/api/transport'

import { probeExpeditionReadiness } from '../api/shipApi'

export type ShipReconciliationState =
  { readonly kind: 'idle' } | { readonly kind: 'updating' } | { readonly kind: 'delayed' }

/**
 * Cumulative probe schedule after a successful Ship repair
 * (`web-frontend.md` §3.4): reconcile immediately and after approximately
 * 1, 2, 4, and 8 seconds.
 */
const FIRST_PROBE_DELAY_MS = 0
const PROBE_DELAY_STEPS_MS: readonly number[] = [1_000, 1_000, 2_000, 4_000]
/** While the tab is hidden or offline, wait briefly and re-check before probing. */
const PAUSED_PROBE_POLL_MS = 250

/**
 * Bounded Ship-to-Expedition readiness reconciliation (`web-frontend.md`
 * §3.4). After `beginReconciliation(balance)` it probes the Expedition quote
 * until it reflects the authoritative balance, pausing while the tab is hidden
 * or offline. If the bounded window expires, it surfaces `delayed` and
 * `retryReconciliation` starts a fresh round.
 */
export function useShipRepairReconciliation(transport: ApiTransport) {
  const [reconcileBalance, setReconcileBalance] = useState<number>()
  const [reconcileRound, setReconcileRound] = useState(0)
  const [reconciliation, setReconciliation] = useState<ShipReconciliationState>({ kind: 'idle' })

  useEffect(() => {
    if (reconcileBalance === undefined) {
      return
    }
    const balance = reconcileBalance
    // Object indirection keeps flow analysis from narrowing `cancelled` to
    // false inside the probe closures (it is only cleared on cleanup).
    const control: { cancelled: boolean } = { cancelled: false }
    const isCancelled = (): boolean => control.cancelled
    let timer: number | undefined
    let step = 0

    const isPaused = (): boolean => document.visibilityState !== 'visible' || !navigator.onLine

    async function runProbe(): Promise<void> {
      if (isCancelled()) {
        return
      }
      setReconciliation({ kind: 'updating' })
      let succeeded: boolean
      try {
        succeeded = await probeExpeditionReadiness(transport, balance)
      } catch {
        succeeded = false
      }
      if (isCancelled()) {
        return
      }
      if (succeeded) {
        setReconciliation({ kind: 'idle' })
        return
      }
      step += 1
      if (step > PROBE_DELAY_STEPS_MS.length) {
        setReconciliation({ kind: 'delayed' })
        return
      }
      scheduleProbe()
    }

    function scheduleProbe(): void {
      const delayMs = isPaused()
        ? PAUSED_PROBE_POLL_MS
        : step === 0
          ? FIRST_PROBE_DELAY_MS
          : (PROBE_DELAY_STEPS_MS[step - 1] ?? 1_000)
      timer = window.setTimeout(() => {
        if (isPaused()) {
          scheduleProbe()
          return
        }
        void runProbe()
      }, delayMs)
    }

    scheduleProbe()

    return () => {
      control.cancelled = true
      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
    }
  }, [reconcileBalance, reconcileRound, transport])

  /** Starts a reconciliation round for the authoritative post-repair balance. */
  const beginReconciliation = (balance: number): void => {
    setReconciliation({ kind: 'updating' })
    setReconcileBalance(balance)
    setReconcileRound((round) => round + 1)
  }

  /** Restarts the bounded window after it expired. */
  const retryReconciliation = (): void => {
    setReconciliation({ kind: 'updating' })
    setReconcileRound((round) => round + 1)
  }

  return { reconciliation, beginReconciliation, retryReconciliation }
}
