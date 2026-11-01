---
type: decision
created: 2026-10-31
updated: 2026-10-31
sources:
  - "User instruction in an OpenCode session, 2026-10-31"
  - "galaxify-monorepo@73b5ae1"
---

# Wiki location: `docs/wiki/` in the repository

## Context

The chief-of-staff needs durable memory that survives context compaction and
future sessions. Two locations were tried:

1. **Personal Obsidian vault** (local, outside this repository) — isolated
   from other projects, but it required a parallel `AGENTS.md` schema and
   duplicated conventions already defined by this repository.
2. **Repository** (`docs/wiki/`) — lives next to the code it describes, is
   versioned with the code, and is governed by the repository's existing
   [`AGENTS.md`](../../../AGENTS.md) and ADR conventions.

## Decision

On 2026-10-31, the agent wiki moved to `docs/wiki/` in `galaxify-monorepo`.
The Obsidian copy was removed.

Reasons:

- No second schema to maintain: the repository's `AGENTS.md` already defines
  how agents work here.
- Commit citations are local: claims can cite `galaxify-monorepo@<sha>`
  without crossing repositories.
- Team-visible and reviewable in the same pull request as the code.

## Consequences

- `docs/wiki/` is agent working memory, not product documentation. It
  complements, and does not replace, `docs/adr/` and `docs/specs/`.
- The wiki is versioned with the code. Changes should be committed with the
  work they describe.
- Personal, non-Galaxify knowledge stays in the Obsidian vault; it is not
  copied here.
