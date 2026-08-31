# ADR-0004: Transactional outbox pattern with HTTP-triggered drain

- **Status:** Accepted
- **Date:** 2026-08-31
- **Source:** Phase 1 cross-cutting ticket [#11](https://github.com/thalesraymond/galaxify-monorepo/issues/11)

## Context

Phase 1 services publish events to RabbitMQ (e.g., Daily Service publishes
`daily.completed` when a daily is marked complete). A naive
publish-from-handler pattern has a critical failure mode:

```
1. Handler commits DB state change.
2. Handler publishes to RabbitMQ.
3. Network blip / RabbitMQ restart → publish fails.
4. Handler returns 500 to client.
5. DB is committed, event is lost → Ship Service never adds materials →
   user-visible bug.
```

Idempotency on the consumer side (`event_id`-based deduplication) does **not**
save us here, because Ship never received the event to dedupe.

The intended deployment target is **Azure Container Apps (ACA) scale-to-zero
on the always-free tier** (see the deployment notes in
`~/obsidian/personal_notes/wiki/Status - Galaxify.md`). Background goroutines
that poll indefinitely prevent ACA from scaling to zero, which would defeat the
budget-friendly intent of the project.

## Decision

Use the **transactional outbox pattern** with an **HTTP-triggered drain** (no
independent goroutine):

- Every publishing service has an `outbox` table:
  `(id, event_id, event_type, payload JSONB, status PENDING|PUBLISHED, created_at, published_at)`.
- When a handler commits a state change that should produce an event, it
  writes the state change **and** the outbox row in the **same DB
  transaction**. Both commit together, or neither does.
- After the handler responds to the client, it fires a **fire-and-forget**
  goroutine that drains pending outbox rows (bounded `LIMIT 50` per drain)
  using `FOR UPDATE SKIP LOCKED` to avoid double-publish across replicas.
- The drain publishes to RabbitMQ via `pkg/events.Publisher` and marks rows
  `PUBLISHED` after broker ack.
- The service has **no background goroutine in `main()`**. When no HTTP
  traffic is present, ACA sees zero activity and scales to zero. On the next
  request, the new instance's drain picks up any accumulated `PENDING` rows.
- Idempotency: consumers dedupe on `event_id` with 30-day retention (see
  `docs/specs/cross-cutting.md` §1). Handles the case where a row is drained
  twice (e.g., drain dies mid-publish, on restart the relay sees it again).

## Alternatives Considered

### Best-effort publish + log on failure

- Pros: simplest; no extra table.
- Cons: accepts event loss; manual replay required for every failed publish;
  wrong foundation for the project's reliability story.
- Rejected: the portfolio intent is to demonstrate at-least-once delivery; the
  implementation cost is bounded.

### Outbox + in-process polling goroutine (every 2 seconds)

- Pros: lower event latency (publishes happen even when no user traffic).
- Cons: prevents ACA scale-to-zero — constant DB polling activity registers as
  "container is doing work"; defeats the always-free-tier intent.
- Rejected: the deployment constraint is real; HTTP-triggered drain achieves
  reliability without paying for an always-on container.

### Outbox + scheduled worker (timer-triggered Azure Function)

- Pros: drains on a schedule independent of user activity.
- Cons: adds a second Azure resource to manage; on the always-free tier,
  reliable timer triggers are not guaranteed.
- Rejected: Phase 1's background-state-propagation semantics don't need
  schedule-independent draining. **Revisit if Phase 2 introduces real-time UX
  requirements.**

### Change Data Capture (Debezium / logical replication)

- Pros: decouples publishing from the service runtime entirely.
- Cons: heavy infrastructure (Debezium Connect cluster, or native Postgres
  logical replication); overkill for Phase 1.
- Rejected: deferred — log as a Phase 2+ candidate if real-time requirements
  emerge.

## Consequences

- Every publishing service (User, Daily, Ship) owns its `outbox` table.
  Expedition only consumes, so no outbox.
- The `outbox` table grows unboundedly. A nightly cron truncates rows where
  `published_at < now() - 30 days` (or `status = 'PUBLISHED'`).
- Event latency is **coupled to user activity**: if a row sits in `outbox` and
  the user closes the app, the event publishes the next time any handler runs
  in the service. For Phase 1's background-state-propagation use case, this is
  acceptable. If Phase 2 introduces real-time UX, the implementation must move
  to a scheduled worker or CDC.
- **Portability note**: the pattern is portable to AWS Lambda / Azure Functions
  without changes to the schema, handler transaction, or idempotency contract.
  The trigger changes from "fire-and-forget goroutine after HTTP handler" to
  "scheduled Lambda invocation that polls the same `outbox` table every N
  seconds." Both rely on `FOR UPDATE SKIP LOCKED` for concurrent-replica
  safety.
- This is **not the optimal solution** for the always-free-tier deployment. A
  dedicated scheduled worker (timer-triggered Azure Function or separate worker
  container) would decouple draining from user activity and is the upgrade
  path. We accept the HTTP-triggered trade-off because (a) Phase 1 doesn't need
  schedule-independent draining and (b) the implementation is bounded. The
  spec records this as a Phase 2 upgrade candidate.
