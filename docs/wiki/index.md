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

## Problems

- [Parallel Playwright worktrees](problems/parallel-playwright-worktrees.md) —
  Fixed dev-server ports and shared screenshot baselines make independent
  parallel lanes test each other or drift after the first merge.

## Subsystems

_None yet._

## Preferences

_None yet._
