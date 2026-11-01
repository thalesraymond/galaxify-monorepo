---
type: problem
created: 2026-11-01
updated: 2026-11-01
sources:
  - "Issue #227 review, galaxify-monorepo@710409f"
  - "galaxify-monorepo@f490ee3"
  - "galaxify-monorepo@a95db7b"
---

# Reconciliation approvals must be generation-scoped

On 2026-11-01, review of #227 found two ways a stale fresh-read approval could
release the balance gate:

- Approvals keyed only to the set of delayed keys: a Daily Retry on the same
  key expires again while no gate surface is mounted, and the earlier read
  still opened the gate.
- Resetting the expiry counter when the last key settles: a later expiry reused
  generation `1` while the hook had already handled `1`, stranding the gate in
  `refreshing`.

The fix is a session-owned monotonic expiry generation in
[`balanceGate.ts`](../../../apps/web-frontend/src/shared/reconciliation/balanceGate.ts).
The Daily adapter advances it on every transition into `delayed`, even when no
gate view is mounted; it never resets during a session, only on session clear.
The gate's read approval is keyed to that generation.

The gate's one-shot fresh read is session-owned as well: unmounting its view
does not cancel it, so another surface or a later mount can use the result
instead of starting a duplicate read. An active-read id discards callbacks from
superseded attempts, while new expiry/retry/session-clear explicitly aborts
and resets. Regression journeys: Dashboard → Dailies retry → second expiry,
and settle-all → later expiry with a reused generation number.

See [downstream reconciliation](../subsystems/downstream-reconciliation.md).
