# ADR-0014: Deep Downstream Reconciliation and Balance Gate Module

- **Status:** Accepted
- **Date:** 2026-11-14
- **Source:** Architectural Review & Deepening Session (`/improve-codebase-architecture`)

## Context

After consolidating frontend eventual-consistency handling onto `apps/web-frontend/src/shared/reconciliation` (see `docs/specs/web-frontend.md` §3.4), the shared `DownstreamReconciliation` module remained relatively **shallow** around four recurring caller responsibilities:

1. **Duplicated Scoped Expectation Stores in Feature Adapters**: `dailyAwardObservation`, `expeditionRewardObservation`, and `launchDeductionObservation` each maintained module-level `Map`s, `Set`s of React listeners, `snapshot` caches for `useSyncExternalStore`, `subscribeToPhase` fan-in bookkeeping, and manual `onClearDownstreamObservations` cleanup hooks solely to track typed expectation metadata alongside active rounds.
2. **Non-Atomic `publish` and `isSatisfied` Ordering + Ad-Hoc Conflict Handling**: Adapters had to mutate module-global metadata inside `publish` and re-read it inside `isSatisfied`, while manually branching on `getPhase(key)` (`replace-when-settled`, `once-per-session`, or `restart`) at every registration site.
3. **Split Balance Gate State Machine**: The Balance Gate contract was split across a key/expiry registry (`balanceGate.ts`) in `src/shared/reconciliation` and 348 lines of module-level controller state (`freshEpoch`, `attemptedGeneration`, `failedGeneration`, 5s timeout timer, visibility/online listeners) inside `features/ship/components/useShipBalanceGate.ts`.
4. **Leaked Integer Session Guards and Global Browser Coupling**: Mutating commands and effect hooks manually compared integer `getDownstreamSessionGeneration()` tokens instead of using an explicit guard seam, and `DownstreamReconciliation` read browser globals (`performance.now`, `Date.now`, `document`, `navigator`, `window`) directly rather than through an injectable seam.

## Decision

We deepen `apps/web-frontend/src/shared/reconciliation` (`downstreamReconciliation.ts`, `useDownstreamObservation.ts`, and `index.ts`) so a single deep module owns the full reconciliation and Balance Gate lifecycle, allowing feature modules to act as thin adapters:

### 1. Scoped Expectation Metadata and `ConflictPolicy` Inside `DownstreamReconciliation`

`DownstreamObservation<Facts, Meta>` accepts optional `scope`, `id`, `meta`, and `onConflict` (`'resume' | 'once-per-session' | 'replace-when-settled' | 'restart'`). The session store owns all expectation snapshots, retains settled entries for scoped or `once-per-session` keys within the session, drops them on `clear()`, and exposes reference-stable views via `useDownstreamExpectations<Meta>(scope)`.

### 2. Atomic `publish(facts, meta) => Meta | void` Before `isSatisfied(facts, meta)`

Whenever a fresh read succeeds, the coordinator invokes `publish(facts, meta)` first and commits any returned updated `Meta` into the entry before evaluating `isSatisfied(facts, meta)` and rebuilding the scope snapshot. Feature adapters no longer maintain side `Map`s or phase-listener bridges.

### 3. Built-In Balance Gate (`gatesBalance` and `useBalanceGate`)

`balanceGate.ts` is folded directly into `DownstreamReconciliation`. Observations declare `gatesBalance: true`; `DownstreamReconciliation` tracks key holds, monotonic expiry generations, the single per-generation verification read (bounded to 5 seconds), availability pause/abort/resume, and player `retryBalanceGate()`. `useShipBalanceGate.ts` shrinks to a ~55-line adapter translating `useBalanceGate(...)` state and Ship query timestamps into UI reasons and balance facts.

### 4. `SessionGuard` (`captureDownstreamSession` and `useDownstreamSession`)

Callers capture an opaque `SessionGuard` (`generation`, `isCurrent()`, `assertCurrent()`, `run(fn)`) at command submission or component mount rather than comparing raw session integers. Unmounting components capture a session guard once on mount so retired sessions cannot leak registrations into a newly signed-in session.

### 5. Internal `ReconciliationEnvironment` Seam

`DownstreamReconciliation` accepts a `ReconciliationEnvironment` (defaulting to `browserReconciliationEnvironment` for dynamic lookup of clocks, timers, and `document`/`navigator` availability). Tests can supply `createTestReconciliationEnvironment()` to exercise active-time schedules, availability pauses, and Balance Gate timeouts deterministically in memory without global fake-timer monkeypatching.

## Consequences

- **Depth and Locality**: All module-level expectation `Map`s, listener `Set`s, cleanup hooks, and Balance Gate read/timer state now live behind one `DownstreamReconciliation` seam in `src/shared/reconciliation`.
- **Leverage in Callers**: Feature adapters supply only domain reads, cache writes, and satisfaction predicates (`dailyAwardObservation.ts`, `expeditionRewardObservation.ts`, `launchDeductionObservation.ts`, `useShipBalanceGate.ts`, `useShipRepairReconciliation.ts`).
- **Incremental Compatibility**: Legacy free functions (`registerBalanceGateKey`, `unregisterBalanceGateKey`, `markBalanceGateExpired`, `getDownstreamSessionGeneration`) remain thin delegates on the shared singleton for existing tests while production callers use the deepened interface.
