# ADR-0010: Idempotent Consumer Pipeline

- **Status:** Accepted
- **Date:** 2026-09-05
- **Source:** Architectural Review & Deepening Session (`/improve-codebase-architecture`)

## Context

Phase 1 services consume domain events from RabbitMQ (e.g. `apps/daily-service` consumes `user.created` and `user.deleted`). To maintain data integrity and prevent phantom side-effects during broker retries or manual Dead Letter Exchange (DLX) replays, every consumer must process incoming events idempotently and transactionally.

Prior to this decision, event consumers suffered from three architectural friction points:

1. **Boilerplate Duplication & Lack of Locality**: Every consumer copied ~25 lines of envelope unmarshaling, payload deserialization, transaction begin/rollback/commit, and deduplication checks against `processed_events`.
2. **Leaky Transaction Seams & Broken DLX Replays**: When consumers checked `processed_events` outside or ahead of domain transactions, a failure in domain logic could leave an event marked as processed, causing DLX replays or retries to be falsely dropped.
3. **Database Coupling & Skipped Tests**: Consumers depended directly on concrete `*pgxpool.Pool` references rather than narrow interfaces. As a result, consumer unit tests (such as `user_created_test.go`) could not execute without a live PostgreSQL instance running on `localhost:5432`, forcing tests to skip in offline CI environments (`t.Skipf(...)`).

## Decision

We will introduce a shared, generic **Idempotent Consumer Pipeline** adapter in `pkg/events`:

### 1. Higher-Order Middleware Adapter (`pkg/events`)

The pipeline wraps domain handlers into a standard `events.HandlerFunc`:

```go
func NewIdempotentHandler[T any](
    pool TxStarter,
    storeFactory func(tx pgx.Tx) IdempotencyStore,
    handler func(ctx context.Context, tx pgx.Tx, env Envelope, data T) error,
    opts ...ConsumerOption,
) HandlerFunc
```

The resulting `HandlerFunc` plugs directly into `subscriber.Consume(ctx, eventType, handler)` with zero changes required to `Subscriber`.

### 2. Narrow Interfaces at the Seam

- **Transaction Starter**:
  ```go
  type TxStarter interface {
      Begin(ctx context.Context) (pgx.Tx, error)
  }
  ```
  In production, `*pgxpool.Pool` satisfies `TxStarter` directly without adapters. In unit tests, an in-memory fake transaction starter is passed.

- **Idempotency Store (No SQL in `pkg/`)**:
  ```go
  type IdempotencyStore interface {
      InsertProcessedEvent(ctx context.Context, eventID pgtype.UUID) (int64, error)
  }
  ```
  Query definitions remain owned by the consuming service's sqlc code (e.g., `database.New(tx)`). `pkg/events` contains no SQL query definitions.

### 3. Execution & Transaction Lifecycle

1. **Fast-path payload deserialization**: The pipeline decodes `Envelope`, validates `event_id`, and unmarshals the generic payload `T`. If JSON is malformed, it returns an error immediately (Nack to DLX) without opening a database transaction.
2. **Atomic Idempotency & Domain Mutation**: Inside a single database transaction:
   - Calls `store.InsertProcessedEvent(ctx, eventID)`.
   - If `rowsAffected == 0` (duplicate event), the transaction is cleanly rolled back/closed, and the handler returns `nil` (Ack).
   - If first seen, the domain handler `handler(ctx, tx, env, data)` is executed.
3. **Failure Semantics**: If the domain handler returns an error, the transaction is rolled back (rolling back both the mutation and the `processed_events` entry) and the error is returned (Nack to DLX per ADR-0009). This ensures messages replayed from `galaxify.dead_letters` will be processed rather than discarded as false duplicates.

### 4. Testing Strategy: "The Interface is the Test Surface"

- **Pipeline unit tests (`pkg/events`)**: Test envelope unmarshaling, UUID validation, deduplication, rollback on error, and commit on success using an in-memory fake `TxStarter`.
- **Consumer domain tests (`apps/<service>`)**: Consumer functions are tested as pure unit tests with an in-memory fake query executor. Consumer tests no longer skip when a live database is unavailable.

## Consequences

- **Locality**: Transaction management, envelope unmarshaling, deduplication, and error dispatch concentrate in `pkg/events`.
- **Leverage**: Consumers in `daily-service`, `ship-service`, and `expedition-service` shrink from 70+ lines of transport boilerplate to 5–10 lines of domain logic.
- **Testability**: Consumer tests run in-memory in milliseconds without requiring Docker or live PostgreSQL.
- **SQL Ownership**: Preserves clean service boundaries; `pkg/events` does not embed or manage SQL query strings.
