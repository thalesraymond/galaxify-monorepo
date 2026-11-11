# Wiki Log

Append-only record of wiki operations. Parse with:

```sh
grep '^## \[' docs/wiki/log.md | tail -5
```

## [2026-10-31] setup | Created `docs/wiki/` with index, log, and the wiki-location decision
## [2026-10-31] record | Parallel Playwright ports and stacked layout PRs
## [2026-10-31] launch | Parallel worktrees for reconciliation tickets #223-#226

Started four independent lanes from `main` for the open unblocked reconciliation
issues. Each lane has a dedicated branch and implementer-opencode subagent:

- `feature/223-daily-awards-reconcile` → #223
- `feature/224-ship-repair-readiness` → #224
- `feature/225-expedition-launch-deduction` → #225
- `feature/226-expedition-rewards-reconcile` → #226

Tickets are coupled through the shared Downstream Reconciliation module; the
previous stacked-layout decision recommends stacking for coupled UI work. These
branches are independent for now so implementers can work in parallel, but a
merge/integrate step will likely be needed before landing. See
[`decisions/stacked-layout-prs.md`](decisions/stacked-layout-prs.md) and
[`problems/parallel-playwright-worktrees.md`](problems/parallel-playwright-worktrees.md).

## [2026-11-01] record | Fake timers must fake `performance` for bounded observations

The shared Downstream Reconciliation module measures active time with
`performance.now()`. `apps/web-frontend/src/test/fakeTimers.ts` narrowed
Vitest's `toFake` list to keep React responsive and left `performance` out, so
every bounded observation read its first fact and then froze before its 1/2/4/8
second marks. The helper now fakes `performance` too. See
[`problems/fake-timers-freeze-bounded-observations.md`](problems/fake-timers-freeze-bounded-observations.md).

## [2026-11-01] record | A module-level subscription never pauses an observation

The shared Downstream Reconciliation module counts visible observers as the
only thing that keeps reads running. The Daily award adapter followed its
round's phase with a module-level `subscribe`, so `hasObserver` was
permanently true and pending observations never paused while no view
displayed the affected Ship balance (spec §3.2). The module now has a
phase-only seam (`subscribeToPhase`), the completed row is the visible
observer, and a completion after a delayed round restarts the bounded budget
instead of being swallowed by the expired one. See
[`problems/module-level-subscription-never-pauses-observations.md`](problems/module-level-subscription-never-pauses-observations.md).

## [2026-11-01] record | Serial workflow and Ship repair observation tests

The user authorized a serial issue → review → PR → green CI → merge loop and
approved mocked-HTTP UI and public observation/coordinator APIs with controlled
clocks as test seams for #224. The partial Ship repair migration is recorded at
galaxify-monorepo@535e41428b38cf25606f2c1c4d74ab50acffd576; review identified
that resuming a hidden tab can incur up to 250 ms of visibility polling before
active time accrues, and singleton observations must be cleared before fake
timers are restored to isolate tests. Completion and verification remain subject
to review and CI.

## [2026-11-01] cleanup | Remove unused Ship readiness probe

Review of galaxify-monorepo@89969b59acbbaec96f431b84280e50e07d98dcc2 found
the Ship API readiness probe was referenced only by its dedicated tests. Removed
the obsolete probe and those tests; the Ship API, query, and panel tests, full
unit suite, formatting, typecheck, lint, and production build passed. Full browser
verification remains for CI because Firefox and WebKit are unavailable locally.

## [2026-11-01] record | Locked Playwright verification and reconciliation navigation

At galaxify-monorepo@dfb2577db9d07c3f3dd0cf6340c3f0ff8df6923d, a locked
install corrected the stale Playwright version. Full verification reached the
cross-browser gate: Firefox passed, but WebKit and mobile WebKit could not
launch because host libraries were missing. See the
[problem note](problems/playwright-lock-install-mismatch.md),
[subsystem map](subsystems/downstream-reconciliation.md), and
[subsequent ticket decision](decisions/bounded-reconciliation-tickets.md).
This supersedes the earlier assumption that Firefox and WebKit were unavailable:
Firefox ran successfully, and the WebKit failure reported host libraries.
Issue #224 release was blocked by the implementer's push restriction; no PR
was created and no merge was performed in this task.

## [2026-11-01] merged | Expedition launch deduction

Issue #225 (PR #262, galaxify-monorepo@6ec832c) moved launch deduction onto the
shared module with a pre-submit baseline, session-owned expectation, navigation
resume, Retry, and session clearing. Review strengthened two tests that could
not detect success-time baselines or retained-data confirmation; the race and
the QueryClient route seam are recorded in
[`problems/reconciliation-baseline-capture.md`](problems/reconciliation-baseline-capture.md).
Full frontend gate passed in CI in 6m07s. Resolution reward remains on the local
scheduler for #226.

## [2026-11-01] merged | Expedition rewards across views

Issue #226 (PR #264, galaxify-monorepo@7a2e880) moved reward observation onto
the shared module, retained a pre-resolution Ship snapshot validated by
`updated_at < result.created_at`, registered from the overview, detail, and
Dashboard, and removed the last local probe scheduler. History deliberately
does not discover rewards. Review rejected `as unknown as` in E2E and required
pre-mounted and already-rewarded baseline cases plus two independent pending
identities; all landed in `01f695f`. Coverage mode exposed an unrelated
focus/`aria-current` race, stabilized in `0906a5e` and recorded in
[`problems/split-ui-settlement-assertions.md`](problems/split-ui-settlement-assertions.md).
Full frontend gate passed in CI in 5m50s.

## [2026-11-01] merged | Balance-dependent action gate

Issue #227 (PR #266, galaxify-monorepo@a95db7b) added a session registry of
pending Daily award keys and a Ship gate hook that observes those keys, closes
Repair/Launch while awards update, and releases only after a successful
authoritative Ship read following expiry. Review found and fixed two lifecycle
bugs: same-key retries reusing an approval, and generation reuse after the last
key settled. The fix uses monotonic session generations and a session-owned
one-shot read; see
[`problems/reconciliation-approval-generations.md`](problems/reconciliation-approval-generations.md).
Full frontend gate passed in CI in 5m50s. Cross-flow verification remains #228.

## [2026-11-01] merged | Reconciliation consolidation

Issue #228 (PR #268, galaxify-monorepo@268352d) completed the Downstream
Reconciliation migration: shared session generations guard Daily, repair,
launch, result, and reward callbacks; the Ship seam rejects cancelled/reverted
or command-superseded reads; the gate pauses hidden/offline; and a combined
real-caller suite plus a Chromium journey cover the flows together. Review found
and fixed a retained-cache publication path in `observeShip`; see
[`problems/tanstack-revert-retained-cache.md`](problems/tanstack-revert-retained-cache.md).
Full frontend gate passed in CI in 5m58s. Remaining non-blocking risk: hiding a
gate surface can abort a Ship read another observation joined; the round retries.

## [2026-11-10] approved | After hours redesign specification and handoff

The driving user approved the full frontend redesign spec and seven-ticket
implementation breakdown in
[Approve the redesign specification and implementation handoff](https://github.com/thalesraymond/galaxify-monorepo/issues/276).
The approved prototype is `dca3e21`; production implementation and merge remain
separate work. See
[`decisions/after-hours-redesign-handoff.md`](decisions/after-hours-redesign-handoff.md)
and [`../specs/frontend-redesign.md`](../specs/frontend-redesign.md).
