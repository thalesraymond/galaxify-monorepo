---
type: decision
created: 2026-10-31
updated: 2026-10-31
sources:
  - "OpenCode session implementing issues #222, #244-#249, 2026-10-31"
  - "galaxify-monorepo@73b5ae1"
---

# Stack overlapping layout tickets instead of rebasing them onto main

## Context

Issues #244, #245, #248, #249, #246, and #247 all change the Dashboard/Dailies
layout or its visual baselines. Independent branches start green but develop
merge conflicts and stale screenshots as soon as the first one lands. A single
combined PR would hide per-ticket review, and a follow-up baseline PR would
leave `main` red between merges.

## Decision

On 2026-10-31, the six overlapping layout branches were stacked in merge order:

1. `issue-244` — persistent Create Daily
2. `issue-245` — mobile Daily toolbar
3. `issue-249` — navigation labels and disclosures
4. `issue-248` — support-panel height and repair disclosure
5. `issue-247` — route-local desktop widths
6. `issue-246` — Dashboard Daily title rhythm

Each PR targets the preceding branch, and each branch refreshes only the
baselines the combined tree makes stale. `issue-222` (shared reconciliation)
stays independent on `main`.

Merge in the listed order. GitHub retargets each PR to `main` after its base
branch merges.

## Consequences

- Every step in the stack is green: the snapshot at each tip matches the tree
  that will exist after the preceding PRs merge.
- A ticket's PR diff stays scoped to its own commit even though its base is
  another ticket.
- Out-of-order merges need a rebase and a snapshot refresh.
- Prefer this only for genuinely coupled tickets. Independent work stays on
  independent branches.
