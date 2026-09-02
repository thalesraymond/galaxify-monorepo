# User Service Spec — Phase 1

This document specifies the User Service for Galaxify Phase 1. It resolves
map ticket [#9](https://github.com/thalesraymond/galaxify-monorepo/issues/9).

The User Service owns user identity, authentication, and token management.
It is the only service that holds the Ed25519 signing keypair and issues JWTs;
all other services verify tokens via the JWKS endpoint exposed here.

Shared contracts this spec builds on:
[cross-cutting.md](cross-cutting.md), [ADR-0003](../adr/0003-asymmetric-jwt-eddsa-with-jwks.md),
[ADR-0006](../adr/0006-shared-http-error-envelope-and-request-id.md).

---

## 1. Domain model

```
User { id (UUID), email, username, password_hash, created_at, updated_at }
```

- **Email**: canonical unique identifier. Normalized to `LOWER(TRIM(email))`
  before storage and lookup.
- **Username**: display name. Stored as-entered; uniqueness enforced on
  `LOWER(username)`. Allowed characters: `[a-zA-Z0-9_-]`, length 3–30.
- **Password**: hashed with argon2id via `pkg/auth.HashPassword` /
  `pkg/auth.ComparePasswordAndHash` (alexedwards/argon2id, default params).

---

## 2. Database schema

All tables live in `user_db`. Migrations are goose SQL files under
`apps/user-service/sql/schema/`.

### 2.1 `users` table

```sql
-- 003_users.sql
-- +goose Up
CREATE TABLE users (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT        NOT NULL UNIQUE,
    username      TEXT        NOT NULL,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_username_lower_idx ON users (LOWER(username));

-- +goose Down
DROP TABLE users;
```

### 2.2 `refresh_tokens` table

```sql
-- 004_refresh_tokens.sql
-- +goose Up
CREATE TABLE refresh_tokens (
    id         BIGSERIAL   PRIMARY KEY,
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT        NOT NULL UNIQUE,
    family_id  UUID        NOT NULL,
    used       BOOLEAN     NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE refresh_tokens;
```

**Token format**: opaque random string (32 bytes, base64url-encoded).
Stored as-is (no hashing).

**Family-based revocation**: all tokens issued from the same login/signup
share a `family_id`. On rotation, the old token is marked `used = true`
(not deleted). If a used token is presented again (reuse detected), all
tokens sharing that `family_id` are deleted, forcing re-login. This
contains token theft — see §4.3.

**Cleanup**: expired tokens (`expires_at < now()`) are eligible for periodic
deletion. A cron or manual cleanup query suffices for Phase 1.

### 2.3 `signing_keys` table

```sql
-- 005_signing_keys.sql
-- +goose Up
CREATE TABLE signing_keys (
    kid         TEXT        PRIMARY KEY,
    private_key BYTEA       NOT NULL,
    public_key  BYTEA       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE signing_keys;
```

**Deviation from cross-cutting spec / ADR-0003**: the keypair is stored in
`user_db`, not on the filesystem. This avoids the `JWT_PRIVATE_KEY_PATH` env
var and works correctly when multiple instances scale up — every instance
loads the same keypair from the DB instead of generating its own.

**Bootstrap** (on startup):
1. `SELECT * FROM signing_keys ORDER BY created_at DESC LIMIT 1`.
2. If zero rows: generate Ed25519 keypair via `pkg/auth`, insert with
   `kid = today's date (YYYY-MM-DD)`.
3. Cache the keypair in memory for the lifetime of the process.

Phase 1 uses a single active keypair. Key rotation (multiple kids) is
deferred.

### 2.4 Outbox table

Deferred to [#20 — Implement pkg/events outbox drain](https://github.com/thalesraymond/galaxify-monorepo/issues/20).

Phase 1 User Service uses **naive publish**: call `publisher.Publish()`
directly after the DB commit. The dual-write risk (DB committed but publish
fails → lost event) is accepted. When #20 lands, handlers swap the direct
publish for `InsertOutboxRow` inside the transaction + fire-and-forget
`Drain`. Consumer-side idempotency (`pkg/events.ProcessedEvents`) is already
in place.

---

## 3. HTTP API

Base URL: `http://localhost:8081` (default `HTTP_ADDR`). All endpoints use
the cross-cutting error envelope and request ID middleware.

### 3.1 `POST /users` — Signup

**Request:**

```json
{
  "email": "user@example.com",
  "username": "spacecadet",
  "password": "secret123"
}
```

**Validation:**

| Field    | Rules                                          |
|----------|------------------------------------------------|
| email    | Required, valid email format, normalized       |
| username | Required, `[a-zA-Z0-9_-]`, 3–30 chars         |
| password | Required, min 8 chars, no max                  |

**Handler flow:**

1. Validate input → 422 `VALIDATION_FAILED` on failure.
2. Normalize email: `LOWER(TRIM(email))`.
3. Hash password with `auth.HashPassword`.
4. `INSERT INTO users (email, username, password_hash)`.
   - Email conflict → 409 `USER_EMAIL_TAKEN`.
   - Username conflict (functional index) → 409 `USER_USERNAME_TAKEN`.
5. Generate refresh token (32 bytes, crypto/rand, base64url).
6. `INSERT INTO refresh_tokens (user_id, token, family_id, expires_at)`
   with a new `family_id` (UUID v4) and `expires_at = now() + 7 days`.
7. Issue access token via `auth.IssueAccessToken(privKey, kid, userID, email)`.
8. Naive-publish `user.created` event (see §5.1).
9. Return 201.

**Response (201 Created):**

```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "spacecadet",
    "created_at": "2026-09-01T12:00:00Z",
    "updated_at": "2026-09-01T12:00:00Z"
  },
  "access_token": "eyJ...",
  "refresh_token": "dGhpcyBpcy..."
}
```

### 3.2 `POST /auth/login`

**Request:**

```json
{
  "email": "user@example.com",
  "password": "secret123"
}
```

Login by email (not username). Same error for wrong email and wrong
password to prevent user enumeration.

**Handler flow:**

1. Validate input → 422 `VALIDATION_FAILED`.
2. Normalize email.
3. `SELECT * FROM users WHERE email = $1` → not found → 401
   `USER_INVALID_CREDENTIALS`.
4. `auth.ComparePasswordAndHash(password, user.password_hash)` → mismatch →
   401 `USER_INVALID_CREDENTIALS`.
5. Generate refresh token, insert with new `family_id`.
6. Issue access token.
7. Return 200.

**Response (200 OK):** same shape as signup.

### 3.3 `POST /auth/refresh`

**Request:**

```json
{
  "refresh_token": "dGhpcyBpcy..."
}
```

**Handler flow — implements `pkg/auth.RefreshTokenStore.Rotate`:**

1. Look up presented token: `SELECT * FROM refresh_tokens WHERE token = $1`.
2. **Not found** → 401 `AUTH_INVALID_TOKEN` (expired and purged, or
   never existed).
3. **Found, `used = true`** → reuse detected (token theft):
   - `DELETE FROM refresh_tokens WHERE family_id = $1` (nuke entire family).
   - Return 401 `AUTH_INVALID_TOKEN`.
4. **Found, `used = false`, `expires_at < now()`** → expired →
   401 `AUTH_INVALID_TOKEN`.
5. **Found, `used = false`, not expired** → valid rotation:
   a. `UPDATE refresh_tokens SET used = true WHERE id = $1`.
   b. Generate new token, `INSERT INTO refresh_tokens` with same `family_id`.
   c. Look up user by `user_id` (need email for JWT claims).
   d. Issue new access token.
   e. Return 200.

**Response (200 OK):**

```json
{
  "access_token": "eyJ...",
  "refresh_token": "bmV3IHRva2Vu..."
}
```

### 3.4 `GET /users/me` — Auth-protected

**Response (200 OK):**

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "username": "spacecadet",
  "created_at": "2026-09-01T12:00:00Z",
  "updated_at": "2026-09-01T12:00:00Z"
}
```

Uses `sharedhttp.RequireAuth` middleware. Reads `userID` from context via
`sharedhttp.UserIDFromContext`.

### 3.5 `PATCH /users/me` — Auth-protected

**Request:**

```json
{
  "username": "new_name"
}
```

Phase 1: **username only**. Email change and password change require
verification/confirmation flows not in scope.

**Validation:** same username rules as signup.

**Handler flow:**

1. Validate input → 422 `VALIDATION_FAILED`.
2. `UPDATE users SET username = $1, updated_at = now() WHERE id = $2`.
   - Username conflict → 409 `USER_USERNAME_TAKEN`.
3. Return 200 with updated user.

**Response (200 OK):** same shape as `GET /users/me`.

### 3.6 `DELETE /users/me` — Auth-protected

**Request:**

```json
{
  "password": "current_password"
}
```

Password confirmation required to prevent stolen-token account deletion.

**Handler flow:**

1. Look up user by ID from context.
2. `auth.ComparePasswordAndHash` → mismatch → 401 `USER_INVALID_CREDENTIALS`.
3. `DELETE FROM users WHERE id = $1` — cascades to `refresh_tokens`.
4. Naive-publish `user.deleted` event (see §5.2).
5. Return 204 No Content.

### 3.7 `GET /.well-known/jwks.json`

**Response (200 OK):**

```json
{
  "keys": [
    {
      "kid": "2026-09-02",
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "<base64url-encoded public key>",
      "use": "sig",
      "alg": "EdDSA"
    }
  ]
}
```

Reads from the in-memory keypair loaded at startup. No auth required.
Consumer services (`pkg/auth.SimpleJWKSCache`) fetch this endpoint to
verify JWTs.

---

## 4. Auth wiring in `main.go`

1. Load or generate keypair from `signing_keys` table (§2.3).
2. Create `auth.SimpleJWKSCache` pointed at `http://localhost:8081/.well-known/jwks.json`
   (self, for the auth middleware — or inject the key directly since User
   Service owns it).
3. Wire `sharedhttp.RequireAuth(cache)` on protected routes.
4. Pass `privKey` and `kid` to signup/login/refresh handlers for token
   issuance.

---

## 5. Events

### 5.1 `user.created`

Published on signup, after the user row is committed.

```go
// pkg/events/user_created.go (already exists)
type UserCreated struct {
    Version  int    `json:"version"`   // 1
    UserID   string `json:"user_id"`
    Email    string `json:"email"`
    Username string `json:"username"`
}
```

Routing key: `user.created`. Published via `publisher.Publish(ctx,
"user.created", payload)` (naive, no outbox).

### 5.2 `user.deleted`

Published on account deletion, after the user row is deleted.

```go
// pkg/events/user_deleted.go (new)
type UserDeleted struct {
    Version int    `json:"version"`  // 1
    UserID  string `json:"user_id"`
}
```

Routing key: `user.deleted`. Consumers (daily, ship, expedition) should
cascade-delete their per-user data on receipt.

---

## 6. Error codes

| Code                       | HTTP Status | When                                      |
|----------------------------|-------------|-------------------------------------------|
| `VALIDATION_FAILED`        | 422         | Invalid input (see `details.field_errors`) |
| `USER_EMAIL_TAKEN`         | 409         | Email already registered                  |
| `USER_USERNAME_TAKEN`      | 409         | Username already taken (case-insensitive) |
| `USER_INVALID_CREDENTIALS` | 401         | Wrong email/password on login or delete   |
| `AUTH_INVALID_TOKEN`       | 401         | Refresh token invalid, expired, or reused |
| `AUTH_MISSING_HEADER`      | 401         | No Authorization header (middleware)      |
| `AUTH_MISSING_KID`         | 401         | No kid in JWT header (middleware)         |
| `AUTH_UNKNOWN_KID`         | 401         | kid not found in JWKS (middleware)        |
| `AUTH_KEY_FETCH_FAILED`    | 500         | JWKS fetch failed (middleware)            |
| `INTERNAL_ERROR`           | 500         | Unexpected server error                   |

---

## 7. Implementation tickets

All tickets are children of [map #8](https://github.com/thalesraymond/galaxify-monorepo/issues/8).
Each is independently shippable.

| Order | Ticket                                                      | Depends on | Slice                                                                                             |
|-------|-------------------------------------------------------------|------------|---------------------------------------------------------------------------------------------------|
| 1     | User schema + sqlc queries                                  | —          | Migrations 003–005, sqlc queries for users/refresh_tokens/signing_keys, generated Go code.         |
| 2     | Signup handler + keypair bootstrap + JWKS endpoint          | 1          | `POST /users`, `GET /.well-known/jwks.json`, keypair load/generate, naive publish `user.created`.  |
| 3     | Login handler                                               | 2          | `POST /auth/login`.                                                                               |
| 4     | Refresh handler                                             | 3          | `POST /auth/refresh`, family-based rotation.                                                      |
| 5     | Me handlers (GET / PATCH / DELETE)                          | 2          | Auth-protected routes, `user.deleted` event, `UserDeleted` type in `pkg/events`.                  |
| 6     | Integration tests                                           | 5          | Full signup→login→refresh→me→update→delete flow against docker-compose.                           |

---

## 8. Out of scope (Phase 1)

- Email verification, password reset flows.
- OAuth / social login.
- Roles, permissions, RBAC.
- Multi-factor auth.
- Audit log.
- Email and password change via `PATCH /users/me`.
- Key rotation (multiple active kids).
- Outbox-based event publishing (deferred to #20).
