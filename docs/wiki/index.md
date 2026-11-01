# Agent Wiki

Long-lived working memory for agents working in this repository. It survives
sessions and context compaction; it is not product documentation.

**Read this first.** Before making a decision, read the pages linked below.
When you learn something durable, update every page it touches and append an
entry to [`log.md`](log.md).

This wiki complements, and does not replace, [`docs/adr/`](../adr/) and
[`docs/specs/`](../specs/).

## Conventions

- This repository is **public**. Never write secrets, credentials, personal
  data, private URLs, or local absolute paths here. Write only what is safe to
  publish.
- One topic per page. File names are kebab-case inside a type folder:
  - `decisions/` — choices and their rationale
  - `problems/` — recurring failures and their fixes
  - `subsystems/` — how a part of the codebase works
  - `preferences/` — user and team working preferences
- Cite sources; never copy them. Cite commits as `galaxify-monorepo@<sha>`.
- Write history, not the present: date every claim. When something changes, add
  a new dated claim and mark the old one superseded; do not rewrite it.
- `log.md` is append-only:
  `## [YYYY-MM-DD] <verb> | <title>`.

## Decisions

- [Wiki location](decisions/wiki-location.md) — On 2026-10-31, the agent wiki
  moved to `docs/wiki/` in this repository, not the personal Obsidian vault.
- [Stack overlapping layout tickets](decisions/stacked-layout-prs.md) — On
  2026-10-31, six coupled layout PRs were stacked in merge order, each
  refreshing the snapshots the combined tree made stale.
- [Bounded reconciliation tickets](decisions/bounded-reconciliation-tickets.md) —
  On 2026-11-01, subsequent prompts were bounded and required regression fixes,
  locked browser installs, and review of retired callers and helpers.

## Problems

- [Parallel Playwright worktrees](problems/parallel-playwright-worktrees.md) —
  Fixed dev-server ports and shared screenshot baselines make independent
  parallel lanes test each other or drift after the first merge.
- [Fake timers freeze bounded observations](problems/fake-timers-freeze-bounded-observations.md) —
  A narrowed `toFake` list left `performance.now()` real, so shared-module
  observations read once and never advanced. On 2026-11-01, issue #224 also
  exposed visibility-polling margins and session cleanup requirements in tests.
- [Module-level subscriptions never pause observations](problems/module-level-subscription-never-pauses-observations.md) —
  A phase-only subscription counted as a visible observer, so pending
  observations never paused while no view displayed the affected resource.
- [Playwright lock/install mismatch](problems/playwright-lock-install-mismatch.md) —
  On 2026-11-01, stale installed Playwright requested different browser revisions;
  after a locked install, host WebKit libraries blocked full verification.
- [Reconciliation baseline capture](problems/reconciliation-baseline-capture.md) —
  On 2026-11-01, issues #225/#226 showed that success-callback and first-read
  baselines can already include the expected change; capture pre-command
  evidence and test the cache race.
- [Split UI settlement assertions](problems/split-ui-settlement-assertions.md) —
  On 2026-11-01, a coverage-only flake showed focus and `aria-current` settling
  in separate commits; wait for related UI facts together.
- [Reconciliation approval generations](problems/reconciliation-approval-generations.md) —
  On 2026-11-01, #227 showed that gate approvals need monotonic expiry
  generations and session-owned reads, not delayed-key sets or view-scoped reads.

## Subsystems

- [Downstream reconciliation](subsystems/downstream-reconciliation.md) —
  On 2026-11-01, navigation pointers mapped the coordinator, public hook, and
  the Daily, repair, launch, and reward adapters through the reviewed SHA.

## Preferences

- On 2026-11-01, the user authorized a serial issue → review → PR → green CI →
  merge loop, and approved mocked-HTTP UI and public observation/coordinator
  APIs with controlled clocks as issue #224 test seams.
