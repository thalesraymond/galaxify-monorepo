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
