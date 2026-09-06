# Specification: Idempotent Consumer Pipeline

This specification defines the contract, interfaces, lifecycle, and testing strategy for the **Idempotent Consumer Pipeline** in `pkg/events`. It is governed by [ADR-0010](../adr/0010-idempotent-consumer-pipeline.md) and cross-cuts all event-consuming services in the Galaxify monorepo (`daily-service`, `ship-service`, `expedition-service`).

---

## 1. Overview & Objective

The Idempotent Consumer Pipeline is a generic higher-order middleware adapter in `pkg/events`. It encapsulates envelope unmarshaling, payload deserialization, database transaction management, and idempotency deduplication behind a clean, narrow seam.

### Core Guarantees:
1. **At-Least-Once Transport -> Exactly-Once Mutation**: Ensures duplicate deliveries from RabbitMQ or manual DLX replays result in a single persistent domain state change.
2. **Atomic Rollback on Failure**: If a domain handler fails, both the mutation and the `processed_events` entry are rolled back together, guaranteeing that events replayed from `galaxify.dead_letters` (ADR-0009) can be processed successfully rather than dropped as false duplicates.
3. **Database Decoupling for Tests**: Handlers depend on narrow transaction/store interfaces rather than concrete `*pgxpool.Pool` instances, enabling 100% in-memory unit tests without Docker or live PostgreSQL.

---

## 2. Public Interface & Seams (`pkg/events`)

### 2.1. Narrow Interfaces

```go
package events

import (
    "context"

    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgtype"
)

// TxStarter abstracts opening a database transaction.
// *pgxpool.Pool satisfies TxStarter directly in production.
type TxStarter interface {
    Begin(ctx context.Context) (pgx.Tx, error)
}

// IdempotencyStore abstracts the deduplication query.
// It is satisfied by each service's sqlc-generated *database.Queries type.
type IdempotencyStore interface {
    InsertProcessedEvent(ctx context.Context, eventID pgtype.UUID) (int64, error)
}
```

### 2.2. Pipeline Constructor

```go
// ConsumerOption configures pipeline options (e.g. custom logger).
// In pkg/events, ConsumerOption is aliased to Option, enabling reuse of WithLogger.
type ConsumerOption = Option

// NewIdempotentHandler constructs an events.HandlerFunc that decodes payload T,
// ensures idempotency against processed_events, and executes handler inside an atomic tx.
func NewIdempotentHandler[T any](
    pool TxStarter,
    storeFactory func(tx pgx.Tx) IdempotencyStore,
    handler func(ctx context.Context, tx pgx.Tx, env Envelope, data T) error,
    opts ...ConsumerOption,
) HandlerFunc
```

The returned `HandlerFunc` has signature:
```go
type HandlerFunc func(ctx context.Context, eventType string, payload []byte) error
```
This plugs directly into `subscriber.On(eventType, handler)` with zero changes required to `pkg/events.Subscriber`.

---

## 3. Execution Lifecycle & State Machine

```
   Incoming AMQP Message
            │
            ▼
┌───────────────────────────┐
│ 1. Unmarshal Envelope     │ ──(JSON Error)──► Return Error (Nack -> DLX)
└───────────┬───────────────┘
            │
            ▼
┌───────────────────────────┐
│ 2. Unmarshal Typed T      │ ──(JSON Error)──► Return Error (Nack -> DLX)
└───────────┬───────────────┘
            │
            ▼
┌───────────────────────────┐
│ 3. pool.Begin(ctx)        │ ──(DB Error)────► Return Error (Nack -> DLX)
└───────────┬───────────────┘
            │
            ▼
┌───────────────────────────┐
│ 4. InsertProcessedEvent   │
└───────────┬───────────────┘
            │
    RowsAffected == 0? (Duplicate)
     ├─── YES ───► Log "already processed", tx.Rollback(), Return nil (Ack)
     │
    NO (First time seen)
     │
     ▼
┌───────────────────────────┐
│ 5. Execute handler(ctx)   │ ──(Error)───────► tx.Rollback(), Return Error (Nack -> DLX)
└───────────┬───────────────┘
            │
            ▼
┌───────────────────────────┐
│ 6. tx.Commit(ctx)         │ ──(Commit Error)► Return Error (Nack -> DLX)
└───────────┬───────────────┘
            │
            ▼
       Return nil (Ack)
```

### Detailed Lifecycle Steps:
1. **Pre-Transaction Fast Path**:
   - Deserialize `events.Envelope` from `payload []byte`.
   - Parse `env.EventId` into `pgtype.UUID`.
   - Deserialize typed payload `T` from `env.Payload`.
   - *Failure Mode*: If either JSON deserialization or UUID parsing fails, log a descriptive error and return immediately. RabbitMQ rejects the message with `requeue=false`, routing it directly to `galaxify.dlx` (ADR-0009).
2. **Transaction Acquisition**:
   - Acquire a new transaction: `tx, err := pool.Begin(ctx)`. Defers `tx.Rollback(ctx)`.
3. **Idempotency Deduplication**:
   - Instantiate store: `store := storeFactory(tx)`.
   - Call `rows, err := store.InsertProcessedEvent(ctx, eventID)`.
   - If `rows == 0`, the event has already been committed by a prior delivery. Log an informational skip message, roll back the transaction (no-op since no mutation occurred), and return `nil`. RabbitMQ acknowledges (`Ack`) the message.
4. **Domain Execution**:
   - Invoke `handler(ctx, tx, env, data)`.
   - If `handler` returns an error, allow the deferred `tx.Rollback(ctx)` to execute and return the error. RabbitMQ Nacks the message to `galaxify.dlx`.
5. **Commit**:
   - Commit the transaction: `tx.Commit(ctx)`.
   - Return `nil`. RabbitMQ Acks the message.

---

## 4. Consumer Implementation Pattern

In consuming services (e.g. `apps/daily-service/internal/consumer`), domain consumer logic is decoupled from transport and transactions:

### 4.1. Domain Handler (`user_created.go`)

```go
package consumer

import (
    "context"
    "fmt"

    "github.com/jackc/pgx/v5"

    "github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/database"
    "github.com/thalesraymond/galaxify-monorepo/pkg/events"
    "github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// HandleUserCreated applies the user.created domain mutation.
func HandleUserCreated(ctx context.Context, tx pgx.Tx, env events.Envelope, data events.UserCreated) error {
    userID, err := sharedhttp.ParseUUID(data.UserID)
    if err != nil {
        return fmt.Errorf("invalid user_id %q: %w", data.UserID, err)
    }

    db := database.New(tx)
    return db.UpsertUserCache(ctx, userID)
}
```

### 4.2. Wiring in `main.go`

```go
subscriber.On("user.created", events.NewIdempotentHandler(
    pool,
    func(tx pgx.Tx) events.IdempotencyStore { return database.New(tx) },
    consumer.HandleUserCreated,
    events.WithLogger(logger),
))
```

---

## 5. Testing Contract ("Replace, Don't Layer")

### 5.1. Pipeline Unit Tests (`pkg/events/idempotent_consumer_test.go`)
Tested with in-memory test doubles:
- `fakeTxStarter`: tracks `Begin` calls and returns a `fakeTx`.
- `fakeTx`: records `Commit` and `Rollback` invocations.
- `fakeIdempotencyStore`: maintains an in-memory set of processed `UUID`s.

Test cases cover:
- Invalid envelope JSON -> fails fast without calling `pool.Begin`.
- Invalid inner payload JSON -> fails fast without calling `pool.Begin`.
- First-time event -> calls `InsertProcessedEvent`, invokes domain handler, commits transaction, returns `nil`.
- Duplicate event (`rows == 0`) -> skips domain handler, rolls back transaction, returns `nil` (Ack).
- Handler error -> rolls back transaction, returns error (Nack).
- Commit error -> returns error (Nack).

### 5.2. Service Domain Consumer Tests (`apps/daily-service/internal/consumer/`)
Consumers test the domain function (`HandleUserCreated`) directly:
- Accepts a test double satisfying `database.DBTX`.
- No live PostgreSQL connection required.
- The previous `t.Skipf("skipping test, db not available")` blocks are deleted. Tests run in under 5ms in offline CI.

---

## 6. Deprecation & Cleanup

1. `pkg/events/idempotency.go`: The existing shallow `ProcessedEvents` struct is deprecated and replaced by the `IdempotentHandler` pipeline.
2. Direct `*pgxpool.Pool` parameters in consumer structs are replaced by handler functions bound via `NewIdempotentHandler`.
