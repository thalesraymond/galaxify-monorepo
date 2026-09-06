# ADR-0011: Domain Lifecycle Modules and Deep Seams

- **Status:** Accepted
- **Date:** 2026-09-06
- **Source:** Architectural Review & Deepening Session (`/improve-codebase-architecture`)

## Context

HTTP handlers in `apps/daily-service` were previously designed following a literal interpretation of ADR-0008, where handlers depended directly on a store interface. However, that interface (`dailyStore`) was **shallow**: it directly mirrored 7 raw sqlc database queries (`CreateDaily`, `ListDailies`, `GetDaily`, `UpdateDaily`, `DeleteDaily`, `MarkDailyComplete`, `GetDifficultyReward`) with driver-specific parameter structs (`database.*Params`).

This design introduced several architectural friction points:

1. **Leaky Domain Logic in Transport Handlers**: The HTTP transport adapter (`DailyHandler`) was forced to orchestrate multi-step business workflows. In `CompleteDaily`, the handler executed `GetDaily` to check pending status, executed `MarkDailyComplete`, queried `GetDifficultyReward`, and published the `daily.completed` event.
2. **Non-Atomic Race Conditions**: Handlers performed preliminary read queries (`GetDaily`) to verify `status == 'PENDING'` prior to executing updates or deletes. Under concurrent requests, this created an uncoordinated race window.
3. **Severe Mock Explosion in Tests**: Handler tests in `daily_test.go` swelled to **948 lines** because every unit test had to mock up to 7 distinct low-level database methods with verbose function callbacks. Testing routing or HTTP error status codes required configuring multi-step database query mocks.
4. **Blocked Transactional Outbox (ADR-0004)**: Reliable event publishing requires inserting outbox rows and updating domain state in the **same database transaction**. Because `dailyStore` exposed only discrete database queries with no transaction lifecycle, implementing ADR-0004 would have forced database transactions directly into the HTTP handler layer.

## Decision

We will introduce a dedicated, deep **Domain Lifecycle Module** (`apps/daily-service/internal/daily`) that owns the daily task state machine, business invariants, and transactional boundaries.

### 1. High-Leverage Domain Interface (`daily.Manager`)

The domain module presents a small, cohesive interface operating purely on standard Go types (`uuid.UUID`, `time.Time`, `string`):

```go
type Manager interface {
	Create(ctx context.Context, input CreateInput) (Daily, error)
	Get(ctx context.Context, userID, id uuid.UUID) (Daily, error)
	List(ctx context.Context, userID uuid.UUID, filter ListFilter) ([]Daily, error)
	Update(ctx context.Context, userID, id uuid.UUID, input UpdateInput) (Daily, error)
	Delete(ctx context.Context, userID, id uuid.UUID) error
	Complete(ctx context.Context, userID, id uuid.UUID) (Daily, error)
}
```

### 2. Encapsulated Transaction Boundaries

`daily.Manager` accepts a transaction starter (`TxStarter`, satisfied by `*pgxpool.Pool` in production):

```go
type TxStarter interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}
```

Multi-step operations (such as completing a daily, looking up difficulty rewards, and staging/publishing domain events) run inside an atomic database transaction managed entirely behind the seam. Callers do not manage connection lifecycles or transaction commits.

### 3. Single-Query Fast Path & Atomic Status Transitions

Status mutations execute single-query conditional updates:
`UPDATE dailies SET status = 'COMPLETED', updated_at = now() WHERE id = $1 AND user_id = $2 AND status = 'PENDING' RETURNING *;`

- **Happy path (fast path)**: Executes in a single database roundtrip with zero race window.
- **Error path**: If `pgx.ErrNoRows` is returned, the module inspects the record within the same transaction to cleanly differentiate `ErrDailyAlreadyCompleted` (or `ErrDailyNotPending`) from `ErrDailyNotFound`.

### 4. Sentinel Domain Errors

The domain module defines standard Go sentinel errors:
- `ErrDailyNotFound`
- `ErrDailyNotPending`
- `ErrDailyAlreadyCompleted`
- `ErrInvalidDifficulty`

The HTTP transport adapter (`DailyHandler`) inspects these errors via `errors.Is()` and maps them to HTTP status codes (`404 NOT_FOUND`, `409 CONFLICT`, etc.) and the shared error envelope (ADR-0006).

### 5. Decoupled HTTP Transport Adapter

`DailyHandler` becomes a pure transport adapter:
- Parses URL paths and JSON bodies into domain types.
- Delegates execution to `daily.Manager`.
- Serializes responses or maps sentinel errors.

Handler tests only need to mock the high-level `daily.Manager` methods, reducing mock boilerplate by over 60%.

### 6. In-Memory Unit Testability

`daily.Manager` depends on an internal narrow store interface satisfied by `*database.Queries`. Both the domain module and the HTTP handler can be thoroughly unit-tested in-memory with fake query executors, requiring no live PostgreSQL instances.

## Consequences

- **Locality**: State machine invariants (`PENDING` -> `COMPLETED`), reward material calculations, and event staging concentrate in `internal/daily`.
- **Leverage**: Callers execute complex domain workflows with a single method call.
- **Outbox Readiness**: Provides the exact transaction seam required for ADR-0004 without coupling HTTP handlers to database transactions.
- **Monorepo Standard**: Establishes the standard domain module separation for upcoming services (`ship-service`, `expedition-service`).
