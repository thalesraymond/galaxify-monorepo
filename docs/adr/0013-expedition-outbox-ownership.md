# ADR-0013: Expedition Service Owns an Outbox for Lifecycle Events

- **Status:** Accepted
- **Date:** 2026-09-07
- **Source:** Expedition Service schema implementation (#74)
- **Supersedes:** The Expedition ownership exception in ADR-0004

## Context

ADR-0004 originally described Expedition as a consumer-only service and therefore
excluded it from the per-service transactional outbox tables. The Expedition
Service specification subsequently defined two lifecycle events,
`expedition.launched` and `expedition.completed`, and issue #74 requires the
service schema to include an `outbox` table.

Those events are published by Expedition and consumed by Ship Service. Publishing
state changes without an outbox would reintroduce the dual-write failure that
ADR-0004 is intended to prevent.

## Decision

Expedition Service owns an `outbox` table using the same schema and lifecycle as
the other event-producing services:

- `expedition.launched` is staged with the expedition launch mutation.
- `expedition.completed` is staged with the expedition resolution mutation.
- A shared outbox drainer publishes pending rows and marks them published after
  broker acknowledgement.
- Consumers remain responsible for idempotency using `processed_events`.

The general outbox design, HTTP-triggered drain, and at-least-once delivery
semantics remain governed by ADR-0004. This ADR supersedes only its statement
that Expedition is consumer-only and does not own an outbox.

## Consequences

- Expedition's database includes both `processed_events` and `outbox`.
- Future Expedition launch and worker implementations must write domain state
  and their corresponding outbox rows in the same transaction.
- The service must use the shared outbox implementation when the publishing
  handlers are added; this schema-only change does not implement those handlers
  or the drainer itself.
- The set of Phase 1 publishing services is User, Daily, Ship, and Expedition.
