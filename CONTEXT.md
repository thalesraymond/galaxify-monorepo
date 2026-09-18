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
