# ADR-0005: Single topic exchange `galaxify.events` with versioned envelope

- **Status:** Accepted
- **Date:** 2026-08-31
- **Source:** Phase 1 cross-cutting ticket [#11](https://github.com/thalesraymond/galaxify-monorepo/issues/11)

## Context

Phase 1 services communicate via events on RabbitMQ. Three foundational
decisions shape the event bus:

1. **Exchange topology** — one vs many exchanges; topic vs fanout vs direct.
2. **Message envelope shape** — raw payload vs wrapped envelope with metadata.
3. **Routing key conventions** — how consumers subscribe to subsets of events.

These decisions are foundational: every service depends on them, and changing
them later means re-wiring every consumer. They lock in the contract that the
per-service spec tickets (Daily, Ship, Expedition, User) build on top of.

## Decision

**Single topic exchange `galaxify.events`**, with a **versioned envelope** and
**`event_type` as the routing key**.

### Exchange

- One exchange, declared by every service on startup:
  `ExchangeDeclare("galaxify.events", "topic", durable=true, autoDelete=false, ...)`.
- Idempotent declaration: services can come up in any order; the first
  declaration wins, all subsequent are no-ops.
- Each service creates its own queues and binds them with patterns it cares
  about. Example: Ship binds `daily.*` (catches both `daily.completed` and
  `daily.missed`); Expedition binds `ship.status_updated` (exact) and
  `user.created` (exact).

### Envelope

Every published message has the shape:

```json
{
  "event_id":   "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "event_type": "daily.completed",
  "occurred_at": "2026-08-30T14:22:11.123Z",
  "version":    1,
  "payload":    { /* event-specific typed struct, also versioned */ }
}
```

- `event_id` (UUID v4): **idempotency key**. Unique per event delivery attempt.
  Consumers dedupe on this field with 30-day retention.
- `event_type`: routing key. Also set as the AMQP routing key on publish.
- `occurred_at`: producer's clock (RFC3339 with sub-second precision).
- `version`: per-event-type schema version. Bumped on incompatible payload
  changes; consumers can branch on it during migrations.
- `payload`: the typed event struct (UserCreated, DailyCompleted,
  DailyMissed, ShipStatusUpdated), JSON-encoded. The payload struct carries its
  own `version` field consistent with the envelope.

The `request_id` of the originating HTTP request (if any) is propagated as an
**AMQP header named `x-request-id`**, not inside the envelope body. This keeps
the envelope pure event-metadata and lets consumers correlate logs to the
originating user action without coupling the event schema to the HTTP
transport.

### Routing key convention

Routing keys follow `<entity>.<verb>`:

- `user.created`
- `user.deleted`
- `daily.completed`
- `daily.missed`
- `ship.status_updated`

The convention scales to arbitrary event families in later phases (e.g.,
`probe.mined`, `raid.damage_dealt`).

## Alternatives Considered

### Multiple exchanges per event family

- e.g., `galaxify.user`, `galaxify.daily`, `galaxify.ship`.
- Pros: visual isolation per domain.
- Cons: more infra to manage; the topic exchange already provides per-domain
  isolation via routing-key patterns.
- Rejected: the topic exchange gives us the same isolation with less ceremony.

### Fanout exchange

- Pros: simplest — every consumer sees every message.
- Cons: every consumer must filter messages client-side; Ship doesn't want
  `user.created`, Expedition doesn't want `daily.missed`.
- Rejected: the project explicitly needs selective subscription.

### Direct exchange

- Pros: precise 1:1 routing via exact queue name match.
- Cons: no pattern matching; binding per (event_type, consumer) combination
  explodes as new event types are added.
- Rejected: topic exchange gives us pattern matching for free (Ship's `daily.*`
  catches both daily events today and any future `daily.<verb>`).

### No envelope — raw payload

- Pros: simpler publish call.
- Cons: no `event_id` for idempotency; no schema version evolution; no
  consistent metadata.
- Rejected: the envelope's metadata is what makes reliability patterns
  (idempotency, versioning, traceability) work; the cost is one struct wrapper.

### Putting `request_id` inside the envelope body

- Pros: clients see it in the message body.
- Cons: makes `request_id` part of the event contract; couples event shape to
  HTTP transport.
- Rejected: keep `request_id` as transport-layer metadata (AMQP header);
  envelope body stays pure event payload.

## Consequences

- Every service's `pkg/events.Publisher` and `pkg/events.Subscriber` are tied
  to this envelope shape. Changing the envelope later means a coordinated
  migration across all services — but the per-event-type `version` field lets
  payload schemas evolve independently.
- Phase 1 defines 4 event types; future phases may add more. The convention
  `<entity>.<verb>` scales to arbitrary event families.
- The envelope is implemented in `pkg/events/envelope.go` with the typed
  payload structs in `pkg/events/<event_type>.go`. Consumers and publishers
  both import from `pkg/events`.
- The `expedition.process` queue referenced in the obsidian notes is a
  **command queue** (a service-to-service async task), not an event
  broadcast — it belongs in the Expedition spec ticket, not in this
  cross-cutting spec.
