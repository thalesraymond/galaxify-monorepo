# ADR-0006: Shared HTTP error envelope and request ID middleware

- **Status:** Accepted
- **Date:** 2026-09-01
- **Source:** Phase 1 cross-cutting ticket [#11](https://github.com/thalesraymond/galaxify-monorepo/issues/11), spec §3 + §4 in [`docs/specs/cross-cutting.md`](../specs/cross-cutting.md)

## Context

Phase 1 services (user, daily, ship, expedition) are independently deployable
Go HTTP servers consumed by the web frontend and, eventually, by each other.
Two cross-cutting decisions are foundational and shape every endpoint in every
service:

1. **Error response shape** — without a shared envelope, every handler
   hand-rolls its own JSON (`{"error": "..."}`, `{"message": "..."}`, plain
   `http.Error` text, etc.), making the frontend's error-handling code branch
   on implementation details rather than on stable error codes.
2. **Request correlation** — when the frontend reports a bug ("my daily didn't
   complete"), support needs a single key to correlate the user's complaint
   to the right log lines across services.

These decisions are foundational: every endpoint in every service depends on
them, and changing them later means touching every handler.

## Decision

### 1. Shared error envelope (`pkg/sharedhttp/errors.go`)

Every error response across all services has this shape:

```json
{
  "error": {
    "code": "DAILY_NOT_FOUND",
    "message": "Daily task not found",
    "details": null
  }
}
```

- `error.code` is a flat SCREAMING_SNAKE identifier.
- `error.code` is **orthogonal** to the HTTP status — clients branch on
  `code`, not on status. Multiple errors can share a status (e.g.,
  `USER_EMAIL_TAKEN` is 409 Conflict; `USER_INVALID_CREDENTIALS` is 401
  Unauthorized); one logical error can also be implemented at multiple
  statuses over time.
- `error.message` is a human-readable string. Safe to show to end users
  (never include internal error details for 5xx responses).
- `error.details` is populated only for `VALIDATION_FAILED` (422), as
  `{"field_errors": {"<field>": "<human message>"}}`.
- The `X-Request-Id` response header is set on **every** response (success
  and error) — it never appears in the envelope body. It is the lookup key
  support uses to correlate logs to a user-reported issue.

#### Code naming

`code` is a flat SCREAMING_SNAKE with a service-specific prefix. Each service
owns its own prefix by convention; there is no central registry. Uniqueness is
enforced by code review, not by tooling.

Reserved cross-cutting codes:

| Code                    | Status | Meaning                                                                |
| ----------------------- | ------ | ---------------------------------------------------------------------- |
| `VALIDATION_FAILED`     | 422    | Always paired with `details.field_errors`.                             |
| `INTERNAL_ERROR`        | 500    | Generic; underlying error logged with `request_id`.                    |
| `AUTH_MISSING_HEADER`   | 401    | `Authorization` header absent or empty.                                |
| `AUTH_INVALID_TOKEN`    | 401    | Bearer prefix missing or JWT signature/audience/issuer/expiry invalid. |
| `AUTH_MISSING_KID`      | 401    | JWT header has no `kid`.                                               |
| `AUTH_UNKNOWN_KID`      | 401    | JWT `kid` not in JWKS after force-refresh.                             |
| `AUTH_KEY_FETCH_FAILED` | 500    | JWKS endpoint unreachable.                                             |

Per-service codes (illustrative):

- **User**: `USER_NOT_FOUND`, `USER_EMAIL_TAKEN`, `USER_USERNAME_TAKEN`,
  `USER_INVALID_CREDENTIALS`.
- **Daily**: `DAILY_NOT_FOUND`, `DAILY_NOT_EDITABLE`, `DAILY_ALREADY_COMPLETED`.
- **Ship**: `SHIP_NOT_FOUND`, `SHIP_INSUFFICIENT_MATERIALS`, `SHIP_HULL_FULL`.
- **Expedition**: `EXPEDITION_NOT_FOUND`, `EXPEDITION_ALREADY_ACTIVE`.

#### Helpers

- `sharedhttp.WriteError(w, status, code, message)` — generic error.
- `sharedhttp.WriteValidationError(w, fieldErrors)` — 422 + `VALIDATION_FAILED`.
- `sharedhttp.WriteInternal(w, r, err, logger)` — 500 + `INTERNAL_ERROR`, logs
  `err` with the `request_id` from context.

Never return `http.Error` or hand-rolled JSON for an error. Always go through
the helpers so the envelope stays consistent across services.

### 2. Request ID middleware (`pkg/sharedhttp/middleware.go`)

Every service wraps its mux once at the top of `main()`:

```go
handler := sharedhttp.RequestIDMiddleware(mux)
http.ListenAndServe(addr, handler)
```

- Reads `X-Request-Id` from the incoming request. If absent, generates a
  UUID v4.
- Stores the ID on the request context via a private key type.
- Sets `X-Request-Id` on the response (success and error, on every status).
- Exposes `RequestIDFromContext(ctx) string` for handlers and loggers.

The middleware is the single source of `request_id`. Handlers read it from
ctx; they never re-parse headers.

The auth middleware (`sharedhttp.RequireAuth`) sits **inside** the
request-ID middleware, on the protected sub-mux, so auth errors also carry
the request ID.

## Alternatives Considered

### Per-service error shapes

- Pros: each service picks the shape that fits its domain.
- Cons: the frontend writes a different error parser per service; consistency
  is enforced by code review and slowly erodes.
- Rejected: the cost of consistency is one struct and three helpers; the
  benefit is uniform frontend error handling and a single shape for tests.

### `code` derivable from HTTP status

- Pros: clients only need to check status.
- Cons: 401 covers everything from "missing header" to "expired token" to
  "wrong signature" — clients cannot distinguish recoverable errors
  (`AUTH_INVALID_TOKEN` → try refresh) from terminal ones
  (`AUTH_MISSING_HEADER` → re-login).
- Rejected: orthogonality is the whole point of having a code.

### Logging `request_id` in the response body

- Pros: clients see it without inspecting headers.
- Cons: makes the envelope carry transport-layer metadata; mixes the
  contract (what the error means) with the transport (which request it was).
- Rejected: keep envelope pure; the header is the contract for correlation.

### Per-request logging middleware (observability)

- Pros: structured access logs out of the box.
- Cons: introduces a logging policy; Phase 1 has heterogeneous logging
  conventions per service.
- Rejected: deferred — a future observability ticket can add a per-request
  log line that reads `request_id` from ctx, without revisiting this ADR.

## Consequences

- Every handler that returns an error calls one of the three helpers
  (`WriteError`, `WriteValidationError`, `WriteInternal`). Tests assert the
  envelope shape via `pkg/sharedhttp/errors_test.go`.
- The `X-Request-Id` response header is the contract for support to correlate
  logs. Log lines MUST include `request_id` (slog attribute) so a support
  search by request ID returns all related log lines across services.
- Adding a new error code: pick the prefix your service owns, add it to the
  handler, no central registration. Document it inline in the handler.
- Changing the envelope shape is a breaking change for the frontend. Bump
  the envelope version and coordinate a migration.
- The middleware lives in `pkg/sharedhttp` so every Go module in the
  workspace imports it the same way (no copy-paste per service). The
  `pkg/sharedhttp` module depends only on `pkg/auth` (for `JWKSCache`),
  `slog`, and the standard library.
