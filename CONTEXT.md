# Context — Galaxify

Galaxify is the final project of the Boot.dev backend track: a space-themed
daily-task tracker ("mini Habitica"). It is built as a Go workspace monorepo
(`go.work`) of event-driven microservices, each with its own isolated
PostgreSQL database, communicating through a RabbitMQ message bus.

Repo layout, architecture decisions, and their rationale are recorded in
`docs/adr/`. The README records the completed Phase 1 baseline and links to the
live GitHub issue backlog.

> This file is intentionally minimal: domain vocabulary and glossary entries
> are added lazily as terminology gets settled during implementation.

## Glossary

- **Player**: A person with a Galaxify account who completes Dailies, maintains a Ship, and launches Expeditions.
- **Daily**: A recurring task a Player schedules and either completes or misses; its outcome changes the Player's Ship resources or hull condition.
- **Ship**: The Player's persistent game asset, defined by its hull condition and material inventory.
- **Expedition**: A venture a Player launches by investing Ship materials, then tracks until it resolves as a success or failure.
- **Dead Letter Exchange (DLX)**: A global fanout exchange (`galaxify.dlx`) and queue (`galaxify.dead_letters`) that collects messages that permanently failed processing in any service (e.g. max retries exceeded or hard handler error).
- **Alternate Exchange (AE)**: A global fanout exchange (`galaxify.ae`) and queue (`galaxify.unroutable`) that catches messages published to `galaxify.events` which do not match *any* currently bound queues, preventing silent drops of unmapped routing keys.
- **Idempotent Consumer Pipeline**: The transaction-bound, at-least-once message processing pipeline that guarantees exactly-once domain mutation semantics by executing envelope deduplication against `processed_events` and domain mutations within a single atomic database transaction.
- **Daily Task Lifecycle**: The domain module and state machine that governs daily task states (`PENDING`, `COMPLETED`, `MISSED`), enforces transition invariants, calculates difficulty-based reward materials and damage penalties, and coordinates atomic event publishing within transactional boundaries.
- **Downstream Reconciliation**: Bounded observation of the effects of an accepted Player action on related game state, owned by a deep frontend module (`src/shared/reconciliation`) that coordinates the active-time schedule, scoped expectation metadata, duplicate conflict policies, atomic `publish -> isSatisfied` evaluation, and Player session guards. An observed state can satisfy the expected change without proving which action caused it; a delayed observation does not mean the accepted action failed.
- **Balance Gate**: Session-owned freshness gate inside `Downstream Reconciliation` that closes balance-spending actions (`Ship Repair`, `Expedition Launch`) while a balance-gating observation updates and, after expiry, requires a successful authoritative Ship read for that monotonic expiry generation before reopening.
- **Safe Orbit**: An account-wide pause interval during which a Player's Daily occurrences that come due are forgiven: no hull damage, no `daily.missed` event, and a distinct `SKIPPED` history outcome instead of `MISSED`. Completing a Daily during Safe Orbit remains allowed and is still rewarded and recorded `COMPLETED`.
- **Streak**: A per-Daily count of consecutive completed occurrences, judged in the Daily's persisted `time_zone`. A `SKIPPED` occurrence neither increments nor breaks the streak (it freezes); a `MISSED` occurrence resets it. Informational only — no material or hull effects.
- **Consistency**: An informational ratio `completed / (completed + missed)` over eligible occurrences, reported per-Daily and aggregated per-Player over standard rolling windows in the reporting timezone; `SKIPPED` occurrences are excluded from numerator and denominator.
- **Expedition Funding**: The authoritative settlement of a Player's material investment against their Ship before an Expedition enters flight. A newly launched Expedition waits in `FUNDING_PENDING` (occupying the Player's single active-Expedition slot) until the Ship either confirms the debit and starts the flight timer (`IN_FLIGHT`, locking in success chance from the Ship's hull condition at debit time) or rejects the investment for insufficient materials (`FUNDING_REJECTED`, freeing the active slot without triggering cooldown).
