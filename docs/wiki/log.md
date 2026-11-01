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
