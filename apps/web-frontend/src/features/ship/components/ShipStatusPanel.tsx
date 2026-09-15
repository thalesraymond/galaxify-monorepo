import { useEffect, useRef, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'

import { isApiHttpError, isApiTransportError } from '@/api/transport'
import { useApiTransport } from '@/shared/api/TransportContext'
import {
  Button,
  ContentSurface,
  FormError,
  Gauge,
  LiveRegion,
  Skeleton,
  StatusBadge,
  UnavailableState,
} from '@/shared/ui'

import { formatUpdatedAt } from '../format'
import {
  getShip,
  probeExpeditionReadiness,
  repairShip,
  shipQueryKey,
  type ShipState,
} from '../api/shipApi'
import styles from './ShipStatusPanel.module.css'

/** Bounded reconciliation schedule (`web-frontend.md` §3.4): 1, 2, 4, and 8 s. */
const FIRST_PROBE_DELAY_MS = 1_000
const PROBE_DELAY_STEPS_MS: readonly number[] = [2_000, 4_000, 8_000]
/** While the tab is hidden or offline, wait briefly and re-check before probing. */
const PAUSED_PROBE_POLL_MS = 250

type RepairOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'hull_full' }
  | { readonly kind: 'no_materials' }
  | { readonly kind: 'form'; readonly message: string }
  | { readonly kind: 'unavailable' }

type ReconciliationState =
  { readonly kind: 'idle' } | { readonly kind: 'updating' } | { readonly kind: 'delayed' }

/**
 * Feature-owned Ship status and repair composite (`web-frontend.md` §5.5).
 * Route-agnostic so the Dashboard can compose it without page chrome; the
 * `/ship` route is a thin wrapper around it.
 */
export function ShipStatusPanel() {
  const transport = useApiTransport()
  const queryClient = useQueryClient()

  const shipQuery = useQuery({
    queryKey: shipQueryKey,
    queryFn: ({ signal }) => getShip(transport, signal),
  })

  const repairMutation = useMutation({
    mutationFn: () => repairShip(transport),
    onSuccess: (ship) => {
      queryClient.setQueryData(shipQueryKey, { kind: 'ready', ship } satisfies ShipState)
      setRepairOutcome({ kind: 'none' })
      setAnnouncement('The Ship was repaired.')
      setReconciliation({ kind: 'updating' })
      setReconcileBalance(ship.materials_balance)
      setReconcileRound((round) => round + 1)
    },
    onError: (error: unknown) => {
      setRepairOutcome(classifyRepairError(error))
    },
  })

  const [announcement, setAnnouncement] = useState<string>()
  const [repairOutcome, setRepairOutcome] = useState<RepairOutcome>({ kind: 'none' })
  const [reconcileBalance, setReconcileBalance] = useState<number>()
  const [reconcileRound, setReconcileRound] = useState(0)
  const [reconciliation, setReconciliation] = useState<ReconciliationState>({ kind: 'idle' })
  // Snapshot of "now" at mount so the relative updated-at label renders
  // deterministically without reading the clock during re-renders.
  const [mountedAtMs] = useState<number>(() => Date.now())

  const repairButtonRef = useRef<HTMLButtonElement>(null)
  const outcomeRegionRef = useRef<HTMLDivElement>(null)

  // Clear the announcement so an identical later outcome is announced again.
  useEffect(() => {
    if (announcement === undefined) {
      return
    }
    const handle = window.setTimeout(() => {
      setAnnouncement(undefined)
    }, 4_000)
    return () => {
      window.clearTimeout(handle)
    }
  }, [announcement])

  // Move focus into the failure outcome (its Retry button or Dailies link).
  useEffect(() => {
    if (repairOutcome.kind === 'none') {
      return
    }
    outcomeRegionRef.current?.querySelector<HTMLElement>('a, button')?.focus()
  }, [repairOutcome])

  // Bounded Expedition-readiness reconciliation after a successful repair.
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
      let succeeded = false
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
          : (PROBE_DELAY_STEPS_MS[step - 1] ?? 8_000)
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

  const retryRepair = (): void => {
    setRepairOutcome({ kind: 'none' })
    repairButtonRef.current?.focus()
    repairMutation.mutate()
  }

  const retryReconciliation = (): void => {
    setReconciliation({ kind: 'updating' })
    setReconcileRound((round) => round + 1)
  }

  const shipState = shipQuery.data

  if (shipState === undefined) {
    if (shipQuery.isError) {
      return (
        <UnavailableState
          title="Ship status is unavailable"
          description="We could not reach the Ship service. Try again."
          onRetry={() => void shipQuery.refetch()}
        />
      )
    }
    return (
      <ContentSurface tone="raised">
        <Skeleton lines={3} />
      </ContentSurface>
    )
  }

  if (shipState.kind === 'provisioning') {
    return (
      <ContentSurface tone="raised" className={styles.stateBlock}>
        <StatusBadge status="preparing" />
        <h2>Preparing your Ship</h2>
        <p>The Ship provisions shortly after signup. This usually takes a few seconds.</p>
        <Button variant="secondary" onClick={() => void shipQuery.refetch()}>
          Retry
        </Button>
      </ContentSurface>
    )
  }

  const ship = shipState.ship
  const isStale = shipQuery.isError
  const repairBlocked: 'hull_full' | 'no_materials' | undefined =
    ship.hull_health >= 100 ? 'hull_full' : ship.materials_balance <= 0 ? 'no_materials' : undefined
  const repairDescribedBy =
    repairOutcome.kind !== 'none'
      ? 'repair-outcome'
      : repairBlocked !== undefined
        ? 'repair-guidance'
        : 'repair-mechanic'

  return (
    <ContentSurface tone="raised" aria-labelledby="ship-status-heading" className={styles.panel}>
      <h2 id="ship-status-heading">Ship status</h2>

      {isStale ? (
        <div className={styles.stale}>
          <StatusBadge status="error" label="Stale" />
          <p>Showing the last known Ship status. Refreshing failed.</p>
          <Button variant="secondary" onClick={() => void shipQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      <section className={styles.section} aria-labelledby="ship-hull-heading">
        <h3 id="ship-hull-heading">Hull</h3>
        <Gauge label="Hull health" value={ship.hull_health} max={100} />
      </section>

      <section className={styles.section} aria-labelledby="ship-materials-heading">
        <h3 id="ship-materials-heading">Materials</h3>
        <div className={styles.balanceRow}>
          <strong>{ship.materials_balance}</strong>
          {reconciliation.kind === 'updating' ? <StatusBadge status="updating" /> : null}
          {reconciliation.kind === 'delayed' ? <StatusBadge status="delayed" /> : null}
        </div>

        {reconciliation.kind === 'delayed' ? (
          <div className={styles.delayed}>
            <p>
              The repair is saved, but the Expedition service has not caught up with the new balance
              yet. You can retry now.
            </p>
            <Button variant="secondary" onClick={retryReconciliation}>
              Retry
            </Button>
          </div>
        ) : null}

        <p id="repair-mechanic" className={styles.copy}>
          Repairing spends materials up to the smaller of the missing hull and your balance. Each
          material restores a variable amount of hull.
        </p>

        <div className={styles.repair}>
          {repairBlocked !== undefined ? (
            <p id="repair-guidance" className={styles.copy}>
              {repairBlocked === 'hull_full' ? (
                <>
                  Hull is full. Repair becomes available when the hull is damaged — complete Dailies
                  to keep the Ship healthy.{' '}
                  <Link to="/dailies" className={styles.link}>
                    Open Dailies
                  </Link>
                </>
              ) : (
                <>
                  No materials. Complete Dailies to earn materials for repair.{' '}
                  <Link to="/dailies" className={styles.link}>
                    Open Dailies
                  </Link>
                </>
              )}
            </p>
          ) : null}
          <Button
            ref={repairButtonRef}
            loading={repairMutation.isPending}
            disabled={repairBlocked !== undefined}
            aria-describedby={repairDescribedBy}
            onClick={() => {
              setRepairOutcome({ kind: 'none' })
              repairMutation.mutate()
            }}
          >
            Repair Ship
          </Button>
        </div>

        {repairOutcome.kind !== 'none' ? (
          <div ref={outcomeRegionRef} id="repair-outcome" className={styles.outcome}>
            <RepairOutcomeMessage outcome={repairOutcome} onRetry={retryRepair} />
          </div>
        ) : null}
      </section>

      <p className={styles.secondary}>
        Level {ship.level} · {formatUpdatedAt(ship.updated_at, mountedAtMs)}
      </p>

      {reconciliation.kind === 'delayed' ? (
        <LiveRegion message="The Ship was repaired. Updating Expedition readiness is delayed." />
      ) : null}
      {announcement !== undefined ? <LiveRegion message={announcement} /> : null}
    </ContentSurface>
  )
}

function RepairOutcomeMessage({
  outcome,
  onRetry,
}: {
  outcome: Exclude<RepairOutcome, { kind: 'none' }>
  onRetry: () => void
}) {
  switch (outcome.kind) {
    case 'hull_full':
      return (
        <p role="alert" className={styles.copy}>
          Repair becomes available when the hull is damaged — complete Dailies to keep the Ship
          healthy.{' '}
          <Link to="/dailies" className={styles.link}>
            Open Dailies
          </Link>
        </p>
      )
    case 'no_materials':
      return (
        <p role="alert" className={styles.copy}>
          There are no materials to spend. Complete Dailies to earn materials.{' '}
          <Link to="/dailies" className={styles.link}>
            Open Dailies
          </Link>
        </p>
      )
    case 'form':
      return (
        <>
          <FormError>{outcome.message}</FormError>
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </>
      )
    case 'unavailable':
      return (
        <>
          <p role="alert" className={styles.copy}>
            We could not reach the Ship service. Try again.
          </p>
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </>
      )
  }
}

function classifyRepairError(error: unknown): RepairOutcome {
  if (isApiHttpError(error, 'SHIP_HULL_FULL')) {
    return { kind: 'hull_full' }
  }
  if (isApiHttpError(error, 'SHIP_INSUFFICIENT_MATERIALS')) {
    return { kind: 'no_materials' }
  }
  if (!isApiTransportError(error)) {
    return { kind: 'form', message: 'Something went wrong. Try again.' }
  }
  if (error.kind === 'aborted') {
    return { kind: 'none' }
  }
  if (error.kind === 'api') {
    return error.status >= 500 ? { kind: 'unavailable' } : { kind: 'form', message: error.message }
  }
  return { kind: 'unavailable' }
}
