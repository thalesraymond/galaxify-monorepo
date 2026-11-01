---
type: problem
created: 2026-11-01
updated: 2026-11-01
sources:
  - "Issue #225 review, galaxify-monorepo@310ca3d"
  - "galaxify-monorepo@6ec832c"
---

# Reconciliation baselines captured after the command succeeds

On 2026-11-01, issue #225's first implementation captured the Ship balance in
the launch success callback. That snapshot may already include the deduction,
which lowers the expected threshold and leaves the round `Updating…` forever.
A command's reconciliation baseline belongs to the pre-submit moment: capture
the last successful authoritative query state in the mutation's `onMutate`,
before the command is sent. The Daily award adapter has used this rule since
#223; [the spec](../../specs/web-frontend.md) §3.4 now records it for launches.

Two test traps hid the regression:

- Changing the server balance during the POST does not prove the app's cache
  held the deducted balance when `onSuccess` ran. Hold the POST response open,
  publish the deducted balance into the injected QueryClient, then release the
  response. A success-time baseline then computes the wrong threshold and the
  test fails.
- A failed-refresh test only catches retained-data evaluation when the retained
  balance satisfies the expected threshold. Seed a satisfying retained balance
  while reads fail, then assert the phase stays `updating` and becomes
  `Update delayed`.

The route-test seam added in #225 — `AppProviders.queryClient` and
`renderExpeditionRoute(path, queryClient)` — makes both races deterministic
without a second application-state store. See also
[downstream reconciliation](../subsystems/downstream-reconciliation.md).

## Reward evidence is timestamped

On 2026-11-01, issue #226 extended the rule to Expedition rewards: a Ship
snapshot is usable only when its `updated_at` predates the result's
`created_at`. A cache that already includes the reward must be rejected, or
the expected balance overshoots by the reward and never settles. Without that
evidence the observation still publishes fresh facts, but it never claims
confirmation. See `galaxify-monorepo@7a2e880` and
[downstream reconciliation](../subsystems/downstream-reconciliation.md).
