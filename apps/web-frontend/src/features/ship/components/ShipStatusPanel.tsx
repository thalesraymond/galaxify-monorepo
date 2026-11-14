import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'

import { isApiHttpError, isApiTransportError } from '@/api/transport'
import { useApiTransport } from '@/shared/api/TransportContext'
import { captureDownstreamSession, type SessionGuard } from '@/shared/reconciliation'
import {
  Button,
  ContentSurface,
  Disclosure,
  FormError,
  Gauge,
  LiveRegion,
  Skeleton,
  StatusBadge,
  UnavailableState,
} from '@/shared/ui'

import { formatUpdatedAt } from '../format'
import { getShip, shipQueryKey } from '../api/shipApi'
import { repairShipAndCache } from '../api/shipQueries'
import { useShipRepairReconciliation } from './useShipRepairReconciliation'
import styles from './ShipStatusPanel.module.css'
import { useShipBalanceGate } from './useShipBalanceGate'
import { ShipHullDiagram } from './ShipHullDiagram'

/** Why the Repair control is presently unavailable; shared by eligibility and typed errors. */
type RepairBlocker = 'hull_full' | 'no_materials'

type RepairOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'blocked'; readonly blocker: RepairBlocker }
  | { readonly kind: 'rejected'; readonly message: string }
  | { readonly kind: 'unavailable' }

/** How often the relative "Updated …" label recomputes while the tab is visible. */
const UPDATED_AT_REFRESH_MS = 30_000

/**
 * Feature-owned Ship status and repair composite (`web-frontend.md` §5.5).
 * Route-agnostic so the Dashboard can compose it without page chrome; the
 * `/ship` route is a thin wrapper around it.
 */
export function ShipStatusPanel({
  materialsSync,
  variant = 'detail',
}: {
  materialsSync?: ReactNode
  variant?: 'detail' | 'summary'
} = {}) {
  const transport = useApiTransport()
  const queryClient = useQueryClient()
  const balanceGate = useShipBalanceGate()

  const shipQuery = useQuery({
    queryKey: shipQueryKey,
    queryFn: ({ signal }) => getShip(transport, signal),
  })

  const { reconciliation, beginReconciliation, retryReconciliation } = useShipRepairReconciliation(
    queryClient,
    transport,
  )

  const repairMutation = useMutation({
    mutationFn: (session: SessionGuard) => repairShipAndCache(queryClient, transport, session),
    onSuccess: (_ship, session) => {
      if (!session.isCurrent()) return
      // The Expedition service caches Ship state privately; invalidate its
      // queries so visible downstream data reconciles (`web-frontend.md` §3.4).
      void queryClient.invalidateQueries({ queryKey: ['expeditions'] })
      setRepairOutcome({ kind: 'none' })
      setAnnouncement('The Ship was repaired.')
      setRepairSucceededAt((round) => round + 1)
      beginReconciliation()
    },
    onError: (error: unknown, session: SessionGuard) => {
      if (!session.isCurrent()) return
      setRepairOutcome(classifyRepairError(error))
    },
  })

  const [announcement, setAnnouncement] = useState<string>()
  const [repairOutcome, setRepairOutcome] = useState<RepairOutcome>({ kind: 'none' })
  const [repairSucceededAt, setRepairSucceededAt] = useState(0)

  const repairButtonRef = useRef<HTMLButtonElement>(null)
  const outcomeRegionRef = useRef<HTMLDivElement>(null)
  const statusHeadingRef = useRef<HTMLHeadingElement>(null)

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

  // On failure, move focus into the outcome (its Retry button or Dailies link).
  useEffect(() => {
    if (repairOutcome.kind === 'none') {
      return
    }
    outcomeRegionRef.current?.querySelector<HTMLElement>('a, button')?.focus()
  }, [repairOutcome])

  // On success the Ship typically fills its hull, which disables the Repair
  // control; move focus to the status summary so it never disappears silently.
  useEffect(() => {
    if (repairSucceededAt === 0) {
      return
    }
    statusHeadingRef.current?.focus()
  }, [repairSucceededAt])

  const retryRepair = (): void => {
    if (balanceGate.state !== 'open') return
    setRepairOutcome({ kind: 'none' })
    repairButtonRef.current?.focus()
    repairMutation.mutate(captureDownstreamSession())
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
      <ContentSurface className={styles.loading} aria-busy="true">
        <Skeleton lines={1} />
        <div className={styles.body}>
          <div className={styles.diagramSkeleton}>
            <Skeleton lines={1} />
          </div>
          <Skeleton lines={6} />
        </div>
      </ContentSurface>
    )
  }

  if (shipState.kind === 'provisioning') {
    return (
      <ContentSurface className={styles.stateBlock} aria-labelledby="ship-preparing-heading">
        <StatusBadge status="preparing" />
        <h2 id="ship-preparing-heading">Preparing your Ship</h2>
        <p>The Ship provisions shortly after signup. This usually takes a few seconds.</p>
        <Button variant="secondary" onClick={() => void shipQuery.refetch()}>
          Retry
        </Button>
      </ContentSurface>
    )
  }

  const ship = shipState.ship
  const isStale = shipQuery.isError
  const repairBlocked: RepairBlocker | undefined =
    ship.hull_health >= 100 ? 'hull_full' : ship.materials_balance <= 0 ? 'no_materials' : undefined
  const repairDescribedBy =
    repairBlocked === 'hull_full'
      ? 'repair-guidance'
      : balanceGate.state !== 'open'
        ? 'repair-balance-gate'
        : repairOutcome.kind !== 'none'
          ? 'repair-outcome'
          : repairBlocked !== undefined
            ? 'repair-guidance'
            : 'repair-summary'

  return (
    <ContentSurface
      aria-labelledby="ship-status-heading"
      className={`${styles.panel} ${variant === 'summary' ? styles.summary : ''}`}
    >
      <div className={styles.header}>
        <h2 ref={statusHeadingRef} id="ship-status-heading" tabIndex={-1}>
          Ship status
        </h2>
        <span className={styles.secondary}>Level {ship.level}</span>
      </div>

      {isStale ? (
        <div className={styles.stale}>
          <StatusBadge status="error" label="Stale" />
          <p>Showing the last known Ship status. Refreshing failed.</p>
          <Button variant="secondary" onClick={() => void shipQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      <div className={styles.body}>
        <ShipHullDiagram hull={ship.hull_health} />
        <div className={styles.facts}>
          <section
            className={`${styles.section} ${styles.hull}`}
            aria-labelledby="ship-hull-heading"
          >
            <h3 id="ship-hull-heading">Hull</h3>
            <Gauge label="Hull health" value={ship.hull_health} max={100} />
            <p className={styles.copy}>{ship.hull_health >= 100 ? 'Fully repaired' : 'Damaged'}</p>
          </section>
          <section className={styles.section} aria-labelledby="ship-materials-heading">
            <h3 id="ship-materials-heading">Materials</h3>
            <div className={styles.balanceRow}>
              <strong>{ship.materials_balance}</strong>
              {reconciliation.kind === 'updating' ? <StatusBadge status="updating" /> : null}
              {reconciliation.kind === 'delayed' ? <StatusBadge status="delayed" /> : null}
            </div>
            {materialsSync}

            {reconciliation.kind === 'delayed' ? (
              <div className={styles.delayed}>
                <p>
                  The repair is saved, but we could not confirm current Expedition readiness. You
                  can retry now.
                </p>
                <Button variant="secondary" onClick={retryReconciliation}>
                  Retry
                </Button>
              </div>
            ) : null}

            <div className={styles.repair}>
              {balanceGate.state !== 'open' && repairBlocked !== 'hull_full' ? (
                <div id="repair-balance-gate">
                  <StatusBadge status={balanceGate.state === 'stale' ? 'delayed' : 'updating'} />
                  <p>{balanceGate.reason}</p>
                  {balanceGate.state === 'stale' ? (
                    <Button variant="secondary" onClick={balanceGate.retry}>
                      Retry
                    </Button>
                  ) : null}
                  <LiveRegion message={balanceGate.reason} />
                </div>
              ) : null}
              <div className={styles.repairActions}>
                <Button
                  ref={repairButtonRef}
                  loading={repairMutation.isPending}
                  disabled={repairBlocked !== undefined || balanceGate.state !== 'open'}
                  aria-describedby={repairDescribedBy}
                  onClick={() => {
                    setRepairOutcome({ kind: 'none' })
                    repairMutation.mutate(captureDownstreamSession())
                  }}
                >
                  Repair Ship
                </Button>
                {variant === 'summary' ? (
                  <Link to="/ship" className={styles.link}>
                    Inspect Ship
                  </Link>
                ) : null}
              </div>
              {repairBlocked !== undefined ? (
                <p id="repair-guidance" className={styles.copy}>
                  {blockerMessage(repairBlocked, 'eligibility')}{' '}
                  <Link to="/dailies" className={styles.link}>
                    Open Dailies
                  </Link>
                </p>
              ) : (
                <p id="repair-summary" className={styles.copy}>
                  Spend materials; restoration varies.
                </p>
              )}
              {repairOutcome.kind !== 'none' ? (
                <div ref={outcomeRegionRef} id="repair-outcome" className={styles.outcome}>
                  <RepairOutcomeMessage
                    outcome={repairOutcome}
                    onRetry={retryRepair}
                    disabled={repairBlocked !== undefined || balanceGate.state !== 'open'}
                    describedBy={repairDescribedBy}
                  />
                </div>
              ) : null}
              {variant === 'detail' ? (
                <Disclosure summary="How repair works">
                  <p className={styles.copy}>
                    Repairing spends materials up to the smaller of the missing hull and your
                    balance. Each material restores a variable amount of hull.
                  </p>
                </Disclosure>
              ) : null}
            </div>
          </section>
        </div>
      </div>

      <p className={styles.secondary}>
        <ShipUpdatedAt key={ship.updated_at} updatedAt={ship.updated_at} />
      </p>

      {reconciliation.kind === 'delayed' ? (
        <LiveRegion message="The Ship was repaired. Updating Expedition readiness is delayed." />
      ) : null}
      {announcement !== undefined ? <LiveRegion message={announcement} /> : null}
    </ContentSurface>
  )
}

/**
 * Relative "Updated …" label that recomputes on an interval while the tab is
 * visible, so a long session does not freeze at "just now". `key`ed by the
 * timestamp in the parent so a repaired Ship restarts the label immediately.
 */
function ShipUpdatedAt({ updatedAt }: { updatedAt: string }) {
  const [label, setLabel] = useState<string>(() => formatUpdatedAt(updatedAt, Date.now()))

  useEffect(() => {
    const handle = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        setLabel(formatUpdatedAt(updatedAt, Date.now()))
      }
    }, UPDATED_AT_REFRESH_MS)
    return () => {
      window.clearInterval(handle)
    }
  }, [updatedAt])

  return label
}

function RepairOutcomeMessage({
  outcome,
  onRetry,
  disabled,
  describedBy,
}: {
  disabled: boolean
  describedBy: string
  outcome: Exclude<RepairOutcome, { kind: 'none' }>
  onRetry: () => void
}) {
  switch (outcome.kind) {
    case 'blocked':
      return (
        <p role="alert" className={styles.copy}>
          {blockerMessage(outcome.blocker, 'outcome')}{' '}
          <Link to="/dailies" className={styles.link}>
            Open Dailies
          </Link>
        </p>
      )
    case 'rejected':
      return (
        <>
          <FormError>{outcome.message}</FormError>
          <Button
            variant="secondary"
            onClick={onRetry}
            disabled={disabled}
            aria-describedby={disabled ? describedBy : undefined}
          >
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
          <Button
            variant="secondary"
            onClick={onRetry}
            disabled={disabled}
            aria-describedby={disabled ? describedBy : undefined}
          >
            Retry
          </Button>
        </>
      )
  }
}

/** One copy source for the shared `RepairBlocker` union, per view context. */
function blockerMessage(blocker: RepairBlocker, view: 'eligibility' | 'outcome'): string {
  if (blocker === 'hull_full') {
    return view === 'eligibility'
      ? 'Hull is full. Repair becomes available when the hull is damaged — complete Dailies to keep the Ship healthy.'
      : 'Repair becomes available when the hull is damaged — complete Dailies to keep the Ship healthy.'
  }
  return view === 'eligibility'
    ? 'No materials. Complete Dailies to earn materials.'
    : 'There are no materials to spend. Complete Dailies to earn materials.'
}

function classifyRepairError(error: unknown): RepairOutcome {
  if (isApiHttpError(error, 'SHIP_HULL_FULL')) {
    return { kind: 'blocked', blocker: 'hull_full' }
  }
  if (isApiHttpError(error, 'SHIP_INSUFFICIENT_MATERIALS')) {
    return { kind: 'blocked', blocker: 'no_materials' }
  }
  if (!isApiTransportError(error)) {
    return { kind: 'rejected', message: 'Something went wrong. Try again.' }
  }
  if (error.kind === 'aborted') {
    return { kind: 'none' }
  }
  if (error.kind === 'api') {
    return error.status >= 500
      ? { kind: 'unavailable' }
      : { kind: 'rejected', message: error.message }
  }
  return { kind: 'unavailable' }
}
