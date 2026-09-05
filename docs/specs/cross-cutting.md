# Cross-Cutting Backend Concerns — Phase 1

This document specifies the shared contracts and shared code that every Galaxify
Phase 1 service (user, daily, ship, expedition) depends on. Per-service
concerns (schemas, endpoints, business logic) are specified separately in
`docs/specs/<service>.md` and graduated by tickets #9, #10, #12, #13.

This spec resolves map ticket
[#11](https://github.com/thalesraymond/galaxify-monorepo/issues/11). It is the
foundation those per-service spec tickets build on; once it lands, they become
unblocked.

The decisions recorded here are also captured in
[ADR-0003](../adr/0003-asymmetric-jwt-eddsa-with-jwks.md) (auth),
[ADR-0004](../adr/0004-transactional-outbox-http-triggered-drain.md) (outbox),
[ADR-0005](../adr/0005-galaxify-event-bus-topology.md) (event bus), and
[ADR-0006](../adr/0006-shared-http-error-envelope-and-request-id.md) (HTTP
error envelope and request ID middleware).

---

## 1. Event contracts (`pkg/events`)

### Exchange topology

Single topic exchange `galaxify.events`, declared by every service on startup
(idempotent). Each service creates its own queues and binds them with patterns
it cares about. See ADR-0005 for the full rationale.

To prevent message loss and handle processing failures, we use global safety nets:
- **Alternate Exchange (AE)**: A global fanout exchange `galaxify.ae` and queue `galaxify.unroutable` catches messages published to `galaxify.events` that have no bound queues (e.g., unmapped routing keys). Configured via the `alternate-exchange` argument on the main exchange.
- **Dead Letter Exchange (DLX)**: A global fanout exchange `galaxify.dlx` and queue `galaxify.dead_letters` collects messages that permanently fail processing. Configured via the `x-dead-letter-exchange` argument on service queues.

Replaying messages from either queue is done manually via the RabbitMQ Shovel plugin, moving them back to `galaxify.events`. See [ADR-0009](../adr/0009-dead-letter-and-alternate-exchanges.md) for full details.

### Envelope

Every message published has this shape:

```json
{
  "event_id": "UUID v4",
  "event_type": "string (routing key)",
  "occurred_at": "RFC3339 with sub-second precision",
  "version": 1,
  "payload": {
    /* typed payload, see §Phase 1 event types */
  }
}
```

- `event_id` (UUID v4) is the **idempotency key**.
- `event_type` is also set as the AMQP routing key on publish.
- `version` is the envelope schema version (bumped on incompatible envelope
  changes — payload changes are tracked separately inside the payload).
- The originating HTTP request's `X-Request-Id` (if any) is propagated as the
  AMQP header `x-request-id`. Consumers read it back into `context.Context`.

### Phase 1 event types

```go
// pkg/events/user_created.go
type UserCreated struct {
    Version  int    `json:"version"`   // 1
    UserID   string `json:"user_id"`   // UUID
    Email    string `json:"email"`
    Username string `json:"username"`
}

// pkg/events/daily_completed.go
type DailyCompleted struct {
    Version         int    `json:"version"`          // 1
    UserID          string `json:"user_id"`          // UUID
    DailyID         string `json:"daily_id"`         // UUID
    Difficulty      string `json:"difficulty"`       // EASY | MEDIUM | HARD
    RewardMaterials int    `json:"reward_materials"`
}

// pkg/events/daily_missed.go
type DailyMissed struct {
    Version      int    `json:"version"`        // 1
    UserID       string `json:"user_id"`        // UUID
    DailyID      string `json:"daily_id"`       // UUID
    DamageAmount int    `json:"damage_amount"`
}

// pkg/events/ship_status_updated.go
type ShipStatusUpdated struct {
    Version          int    `json:"version"`           // 1
    UserID           string `json:"user_id"`           // UUID
    HullHealth       int    `json:"hull_health"`       // 0-100
    MaterialsBalance int    `json:"materials_balance"`
}

// pkg/events/user_deleted.go
type UserDeleted struct {
    Version int    `json:"version"`        // 1
    UserID  string `json:"user_id"`        // UUID
}
```

The `expedition.process` queue referenced in the project notes is a
**command queue**, not an event broadcast — it belongs in the Expedition spec
ticket (Note: pending implementation).

### Go API (`pkg/events`)

```go
// Publisher side — services that emit events.
type PublisherChannel interface { /* subset of amqp091.Channel */ }
type Publisher struct { /* ... */ }
func NewPublisher(channel PublisherChannel, opts ...Option) (*Publisher, error)
//   - Accepts functional options; WithLogger(logger *slog.Logger) sets the
//     logger used for debug output (defaults to slog.Default()).
func (p *Publisher) Publish(ctx context.Context, eventType string, payload any) error
//   - Generates event_id (UUID v4).
//   - Sets occurred_at (now).
//   - Wraps payload in envelope, serializes to JSON.
//   - Reads request_id from ctx, sets as AMQP header x-request-id.
//   - Publishes to galaxify.events with routing key = eventType.
//   - Returns error if publish fails (caller — typically the outbox drain — is
//     responsible for retry/leave-pending semantics).

// Subscriber side — services that receive events.
type SubscriberChannel interface { /* subset of amqp091.Channel */ }
type Subscriber struct { /* ... */ }
func NewSubscriber(channel SubscriberChannel, serviceName string, opts ...Option) (*Subscriber, error)
//   - Accepts functional options; WithLogger(logger *slog.Logger) sets the
//     logger used for handler/nack diagnostics (defaults to slog.Default()).
func (s *Subscriber) On(eventType string, handler HandlerFunc)
//   - Registers a handler for one event type.
//   - Internally creates a queue bound to galaxify.events with routing key
//     = eventType. Queue is auto-delete=false, durable=true.
func (s *Subscriber) Start(ctx context.Context) error
//   - Begins consuming; non-blocking.
func (s *Subscriber) Shutdown(ctx context.Context) error
//   - Cancels consumers, waits for in-flight handlers, closes channel.

type HandlerFunc func(ctx context.Context, eventType string, payload []byte) error
//   - Receives the raw JSON payload; consumer is responsible for unmarshaling
//     into its own typed struct (typically the canonical type from pkg/events).
//   - ctx carries request_id (from AMQP header) and event_id (from envelope).
```

### Idempotency

Consumers dedupe on `event_id`. Per-service table:

```sql
CREATE TABLE processed_events (
    event_id     UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX processed_events_processed_at_idx ON processed_events (processed_at);
```

Consumer-side pattern:

```go
tag, err := db.Exec(ctx, `
    INSERT INTO processed_events (event_id) VALUES ($1)
    ON CONFLICT (event_id) DO NOTHING
`, eventID)
if err != nil {
    return err
}
if tag.RowsAffected() == 0 {
    // Already processed — ack and skip.
    return nil
}
// First-time processing — do the work.
```

**Retention: 30 days** via nightly cron per consumer service:

```sql
DELETE FROM processed_events WHERE processed_at < now() - interval '30 days';
```

---

## 2. Auth model (`pkg/auth`)

### Algorithm

EdDSA (Ed25519). User Service holds the keypair; non-user services hold the
public key via JWKS. See ADR-0003 for the full rationale.

### Keypair bootstrap

User Service generates the keypair on first startup if `JWT_PRIVATE_KEY_PATH`
is not set, writing to a configured path (e.g., `./keys/jwt-private.pem` and
`./keys/jwt-public.pem`). On subsequent startups, the existing keypair is
loaded. The public key is exposed via JWKS.

### JWKS endpoint

`GET /.well-known/jwks.json` on User Service returns:

```json
{
  "keys": [
    {
      "kid": "2026-08-31",
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "<base64url-encoded public key>",
      "use": "sig",
      "alg": "EdDSA"
    }
  ]
}
```

### JWT claims

```json
{
  "sub": "user_id (UUID)",
  "iss": "galaxify-user-service",
  "aud": "galaxify",
  "iat": 1725024131,
  "exp": 1725027731,
  "email": "user@example.com"
}
```

### Lifetimes

- **Access token**: 15 minutes.
- **Refresh token**: 7 days. **Single-use** — rotated on every
  `POST /auth/refresh` call. The old refresh token is invalidated atomically
  with the issuance of the new one.

### Verification flow (non-user service)

The auth middleware in `pkg/sharedhttp/middleware.go`:

1. Read `Authorization: Bearer <token>`.
2. Decode JWT header, extract `kid`.
3. Look up `kid` in `auth.SimpleJWKSCache`. The cache has no time-based TTL;
   when `kid` is missing, the middleware **force-refreshes** the JWKS
   document (subject to a 10-second cooldown) and retries.
4. If still missing, return 401 with code `AUTH_UNKNOWN_KID`.
5. Verify signature with the public key (EdDSA).
6. Verify `iss == "galaxify-user-service"`, `aud == "galaxify"`, `exp > now`.
7. Set `userID` (from `sub`) into `context.Context` for handler use.

The complete error-code matrix emitted by the middleware
(`AUTH_MISSING_HEADER`, `AUTH_INVALID_TOKEN`, `AUTH_MISSING_KID`,
`AUTH_UNKNOWN_KID`, `AUTH_KEY_FETCH_FAILED`) is documented in
[ADR-0006](../adr/0006-shared-http-error-envelope-and-request-id.md).

### Password hashing

argon2id via `alexedwards/argon2id` with default params. The hashing function
lives in `pkg/auth/password.go` (`auth.HashPassword` /
`auth.ComparePasswordAndHash`) for reuse; User Service calls it from its
signup handler.

### Refresh token storage

User Service owns the `refresh_tokens` table. `pkg/auth` defines the
`RefreshTokenStore` interface; User Service provides the implementation:

```go
type RefreshTokenStore interface {
    Rotate(ctx context.Context, presentedToken string) (newToken string, userID string, err error)
    // Rotate atomically invalidates `presentedToken` and inserts a fresh one
    // bound to the same user. Returns ErrInvalidRefreshToken if the presented
    // token is unknown or already used.
}
```

This decoupling lets `pkg/auth` be tested with a mock store and keeps the
auth package free of User Service's specific schema.

---

## 3. HTTP error envelope (`pkg/sharedhttp`)

> Design rationale, alternatives considered, and the full contract:
> [ADR-0006](../adr/0006-shared-http-error-envelope-and-request-id.md).
> This section records the on-the-wire shape the spec and tests assert
> against.

### Shape

Every error response has this shape:

```json
{
  "error": {
    "code": "DAILY_NOT_FOUND",
    "message": "Daily task not found"
  }
}
```

The `X-Request-Id` response header is set on every response (success and
error) — it does **not** appear in the envelope body. See §4 for the
middleware that propagates it.

### Code naming

`code` is flat SCREAMING_SNAKE with a service prefix. Each service owns its
prefix by convention; there is no central registry. Code review enforces
uniqueness.

- **User Service**: `USER_NOT_FOUND`, `USER_EMAIL_TAKEN`,
  `USER_INVALID_CREDENTIALS`, `USER_USERNAME_TAKEN`
- **Daily Service**: `DAILY_NOT_FOUND`, `DAILY_NOT_EDITABLE`,
  `DAILY_ALREADY_COMPLETED`
- **Ship Service**: `SHIP_NOT_FOUND`, `SHIP_INSUFFICIENT_MATERIALS`,
  `SHIP_HULL_FULL`
- **Expedition Service**: `EXPEDITION_NOT_FOUND`, `EXPEDITION_ALREADY_ACTIVE`
- **Cross-cutting**: `AUTH_MISSING_HEADER`, `AUTH_INVALID_TOKEN`,
  `AUTH_MISSING_KID`, `AUTH_UNKNOWN_KID`, `AUTH_KEY_FETCH_FAILED`,
  `VALIDATION_FAILED`, `INTERNAL_ERROR`

### Validation errors

422 Unprocessable Entity for validation failures:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "request validation failed",
    "details": {
      "field_errors": {
        "title": "is required",
        "difficulty": "must be one of: EASY, MEDIUM, HARD"
      }
    }
  }
}
```

`details.field_errors` is a flat `{field: human_message}` map.

### Malformed JSON

A request body that fails to parse returns 400 Bad Request with
`code: VALIDATION_FAILED` and a `details.field_errors` map indicating the
parse failure (e.g., `{"body": "invalid JSON"}`).

### Internal errors

500 Internal Server Error returns a generic message:

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
  }
}
```

The actual error is logged with the `request_id` so support can correlate
logs to the failed request. The `X-Request-Id` response header is the lookup
key.

### Status ↔ code mapping

Codes are **not** derivable from HTTP status — they're orthogonal. Clients
branch on `code`, not status. Multiple errors can share a status (e.g.,
`USER_EMAIL_TAKEN` is 409 Conflict; `USER_INVALID_CREDENTIALS` is 401
Unauthorized).

---

## 4. Cross-cutting HTTP middleware (`pkg/sharedhttp`)

> Design rationale and contract: see
> [ADR-0006](../adr/0006-shared-http-error-envelope-and-request-id.md).
> This section records the middleware behavior on the wire.

### Request ID middleware

Every service installs this middleware at the top of its handler chain:

1. Read `X-Request-Id` from incoming request. If absent, generate UUID v4.
2. Put in `context.Context` via a private key type.
3. Set `X-Request-Id` response header on every response (success and error).
4. Provide `RequestIDFromContext(ctx) string` for handlers and loggers.

The middleware is the single source of `request_id` — handlers read it from
ctx, never from a parameter.

### Logging convention

Every service uses `log/slog` with JSON handler in production. Log lines
include `request_id`, `service`, and any handler-specific structured fields.
A full observability middleware (structured log line per request, request
duration, response status) is deferred to a future ticket — see the map's
"Not yet specified" section under Observability.

---

## 5. Health Check Endpoint

Every Galaxify service provides a standard health check endpoint to indicate it is running and responsive.

### `GET /health`

**Response (200 OK):**

```json
{
  "status": "ok",
  "service": "user-service"
}
```

- `status` is always `"ok"` if the service is reachable.
- `service` is the name of the service (e.g., `"user-service"`, `"daily-service"`).
- This endpoint does not require authentication and is not protected by the `RequireAuth` middleware.

---

## 6. Outbox pattern (`pkg/events/outbox.go`)

See ADR-0004 for the full rationale. This section records the schema and the
Go helpers.

### Schema (per publishing service)

```sql
CREATE TABLE outbox (
    id            BIGSERIAL PRIMARY KEY,
    event_id      UUID        NOT NULL UNIQUE,
    event_type    TEXT        NOT NULL,
    payload       JSONB       NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'PENDING',  -- PENDING | PUBLISHED
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ
);
CREATE INDEX outbox_pending_idx ON outbox (created_at) WHERE status = 'PENDING';
```

### Handler pattern

```go
err := h.db.InTx(r.Context(), func(tx pgx.Tx) error {
    if err := updateState(tx, ...); err != nil {
        return err
    }
    return insertOutboxRow(tx, eventID, "entity.verb", payload)
})
if err != nil {
    httperr.Internal(w, r, err)
    return
}
go h.outboxDrainer.Drain(r.Context(), 50)  // fire-and-forget; bounded batch
httperr.OK(w, ...)
```

### Drain function

```go
func (d *OutboxDrainer) Drain(ctx context.Context, maxRows int) {
    rows, err := d.db.Query(ctx, `
        SELECT id, event_id, event_type, payload
        FROM outbox
        WHERE status = 'PENDING'
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
    `, maxRows)
    if err != nil {
        d.logger.Warn("outbox drain query failed", "error", err)
        return
    }
    defer rows.Close()

    for rows.Next() {
        var (
            id        int64
            eventID   uuid.UUID
            eventType string
            payload   []byte
        )
        if err := rows.Scan(&id, &eventID, &eventType, &payload); err != nil {
            d.logger.Warn("outbox drain scan failed", "error", err)
            continue
        }
        if err := d.publisher.Publish(ctx, eventType, payload, eventID); err != nil {
            d.logger.Warn("outbox publish failed; will retry", "outbox_id", id, "error", err)
            continue
        }
        if _, err := d.db.Exec(ctx,
            `UPDATE outbox SET status = 'PUBLISHED', published_at = now() WHERE id = $1`,
            id,
        ); err != nil {
            d.logger.Warn("outbox mark-published failed", "outbox_id", id, "error", err)
            // Note: row stays PENDING; next drain will re-publish. Idempotency
            // on the consumer side (event_id dedup) handles duplicates.
        }
    }
}
```

### Portability note (NOT the optimal solution)

The HTTP-triggered drain couples event latency to user activity. The pattern
is **portable** to AWS Lambda / Azure Functions without changing the schema,
handler transaction, or idempotency contract — replace the in-process
goroutine with a scheduled Lambda invocation that polls the same `outbox`
table every N seconds. Both rely on `FOR UPDATE SKIP LOCKED`.

A **dedicated scheduled worker** (timer-triggered Azure Function or separate
worker container) would be the optimal solution for the always-free-tier
deployment, because it decouples draining from user activity. We accept the
HTTP-triggered trade-off because:

1. Phase 1's background-state-propagation semantics don't need
   schedule-independent draining.
2. The implementation is bounded (one helper, no separate resource to manage).

**If Phase 2 introduces real-time UX requirements (push notifications, live
dashboards), upgrade to a dedicated scheduled worker.**

### ⚠️ `workers/daily-cron` does not use the outbox yet

The missed-daily cron worker (`workers/daily-cron`) only marks dailies as
`MISSED`. It does **not** write to the `outbox` table and does **not** connect
to RabbitMQ. Wiring the `daily.missed` event into the outbox (and adding the
drain call) is part of
[#20](https://github.com/thalesraymond/galaxify-monorepo/issues/20).

---

## 7. Implementation tickets

This spec graduates into the following implementation tickets, all children of
map #8:

1. **`pkg/events` package** — envelope, Publisher, Subscriber, per-event-type
   structs, idempotency helper, outbox drain helper.
2. **`pkg/auth` package** — Ed25519 keypair generation, JWT signing/verification,
   JWKS fetcher with TTL + force-refresh, HTTP middleware, refresh token store
   interface, password hashing.
3. **`pkg/sharedhttp` package** — ErrorResponse struct, WriteError,
   WriteValidationError, WriteInternal helpers, and the request ID
   middleware (per [ADR-0006](../adr/0006-shared-http-error-envelope-and-request-id.md)).
   (Originally specified as `pkg/httperr` + `pkg/http`; the two packages were
   merged into `pkg/sharedhttp` for consistency.)

Per-service implementation (User Service signup/login/refresh/JWKS endpoint;
Daily/Ship/Expedition handlers and consumers) is specified in the per-service
spec tickets (#9, #13, #12, #10), which are unblocked once these three
implementation tickets land.
