---
type: subsystem
created: 2026-11-01
updated: 2026-11-01
sources:
  - "galaxify-monorepo@dfb2577db9d07c3f3dd0cf6340c3f0ff8df6923d"
---

# Downstream reconciliation navigation

On 2026-11-01 at the reviewed SHA, the frontend's bounded observation contract
was described in `docs/specs/web-frontend.md` §3.2. Navigation pointers:

- Coordinator, lifecycle, subscriptions and tests:
  `apps/web-frontend/src/shared/reconciliation/downstreamReconciliation.ts`
  and `downstreamReconciliation.test.ts`.
- Public exports and visible-observer React hook:
  `apps/web-frontend/src/shared/reconciliation/index.ts` and
  `useDownstreamObservation.ts`.
- Ship repair adapter and consumer: `apps/web-frontend/src/features/ship/components/`
  `useShipRepairReconciliation.ts` and `ShipStatusPanel.tsx`; fresh reads are
  defined in `features/ship/api/shipQueries.ts`.
- Daily award adapter and observer: `features/dailies/lib/dailyAwardObservation.ts`
  and `features/dailies/components/DailyRow.tsx` under `apps/web-frontend/src/`.
- Expedition result adapter and observer: `features/expeditions/components/`
  `useExpeditionResultReconciliation.ts` and `ResultPanel.tsx` under the same
  frontend source directory. Session cleanup is in `features/auth/session/SessionProvider.tsx`.
- As of `galaxify-monorepo@6ec832c` (2026-11-01), Expedition launch deduction
  is a session-owned expectation in `features/expeditions/lib/`
  `launchDeductionObservation.ts`, registered from `LaunchForm`'s pre-submit
  mutation context and observed by `ExpeditionOverview`. Launch no longer uses
  the local `useShipReconciliation` scheduler; resolution reward still did at
  that SHA, awaiting #226.
- Baseline and retained-data races are described in
  [reconciliation baseline capture](../problems/reconciliation-baseline-capture.md).

For timing and observer pitfalls see [fake timers](../problems/fake-timers-freeze-bounded-observations.md)
and [module-level subscriptions](../problems/module-level-subscription-never-pauses-observations.md).
- As of `galaxify-monorepo@7a2e880` (2026-11-01), Expedition resolution
  reward is a session-owned expectation in `features/expeditions/lib/`
  `expeditionRewardObservation.ts`, keyed `expedition:{id}:reward`. It is
  registered by the overview transition or resolved-current branch, the detail
  `ResultPanel`, and Dashboard when the current Expedition already carries a
  typed result. History rows never discover rewards; opening a result detail
  may. The baseline must be a confirmed Ship snapshot whose `updated_at`
  predates the result's `created_at`; if the snapshot may already include the
  reward, fresh facts are published but confirmation is never claimed. The
  local `useProbeSchedule` / `useShipReconciliation` scheduler was removed at
  that SHA.
- As of `galaxify-monorepo@a95db7b` (2026-11-01), balance-dependent Repair and
  Launch gates use `shared/reconciliation/balanceGate.ts` (session key
  registry plus a monotonic expiry generation) and
  `features/ship/components/useShipBalanceGate.ts` (visible observer,
  session-owned one-shot fresh read, 5 s bound). The Daily adapter registers
  each pending award key and calls `markBalanceGateExpired()` on every
  transition into `delayed`. The gate releases only after a successful
  authoritative Ship read following that expiry; failures show stale feedback
  and a gate Retry. See [approval generations](../problems/reconciliation-approval-generations.md).
- As of `galaxify-monorepo@268352d` (2026-11-01), issue #228 completed the
  migration: Daily awards, repair readiness, launch deduction, result and
  reward observation, and the balance gate all use the shared module; no local
  probe scheduler remains. Command callbacks carry a shared session generation,
  and the Ship seam rejects cancelled/reverted or command-superseded reads. The
  combined cross-flow suite lives in `src/app/pages/ReconciliationCrossFlow.test.tsx`;
  the browser journey is `e2e/reconciliation-flows.spec.ts`. See
  [TanStack revert retained cache](../problems/tanstack-revert-retained-cache.md).
