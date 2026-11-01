---
type: problem
created: 2026-10-31
updated: 2026-10-31
sources:
  - "OpenCode session implementing issues #222, #244-#249, 2026-10-31"
  - "galaxify-monorepo@73b5ae1"
---

# Parallel Playwright worktrees collide on ports and visual baselines

## Symptom

Several worktrees can run E2E at the same time, but
`apps/web-frontend/playwright.config.ts` hardcodes the mock server to `4174`
and the outage server to `4175`. Because `reuseExistingServer` is enabled
outside CI, a lane can silently test another lane's dev server.

Layout tickets also collide even when unit tests pass:

- Several tickets edit the same `test:visual` / `test:e2e:mock` script line.
- Screenshot baselines encode the combined layout, so a snapshot updated in one
  ticket becomes stale after another ticket changes the same page.
- Shared pages (`DailiesListPage`, `DashboardDailiesPanel`) merge textually but
  need a deliberate combined layout.

## Fix

- Run E2E suites one lane at a time, or override ports locally (for example
  with a temporary, uncommitted config or environment support). Do not commit a
  lane-specific config.
- When tickets touch the same UI or baselines, stack their branches in merge
  order and refresh the affected snapshots at the tip. See
  [Stack overlapping layout tickets](../decisions/stacked-layout-prs.md).
- If a snapshot fails after a merge, inspect the diff first. Refresh only the
  baselines the combined change explains.

A combined tree can be validated in a scratch `integration` worktree before
any PR is merged.
