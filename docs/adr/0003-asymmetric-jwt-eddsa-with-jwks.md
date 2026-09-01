# ADR-0003: Asymmetric JWT (EdDSA) with JWKS endpoint

- **Status:** Accepted
- **Date:** 2026-08-31
- **Source:** Phase 1 cross-cutting ticket [#11](https://github.com/thalesraymond/galaxify-monorepo/issues/11)

## Context

Phase 1 has 4 services (user, daily, ship, expedition). User Service issues auth
tokens; the other 3 must validate them locally without round-tripping to User
Service on every request. We need a token format that:

- Can be validated by any service holding the verification material.
- Does **not** require all services to hold minting capability — a compromised
  non-user service must not be able to forge tokens for arbitrary users.
- Supports key rotation without service-wide redeploys.

## Decision

Use **asymmetric JWTs signed with EdDSA (Ed25519)**:

- User Service holds a single Ed25519 keypair. The **private key signs** tokens;
  the **public key verifies**.
- The public key is exposed via `GET /.well-known/jwks.json` on User Service as
  a JWK with a `kid` (key ID).
- Non-user services fetch the JWKS document on startup and cache it with a
  **1-hour TTL**.
- On verification, if a token's `kid` is not in the cached JWKS, the service
  **force-refreshes** the JWKS document immediately, then retries. This handles
  mid-rotation windows without waiting for TTL expiry.
- During rotation, User Service generates a new keypair and the JWKS endpoint
  serves **both** old and new public keys for a **30-minute transition window**
  (well above the 15-minute access-token lifetime).
- Claims: `sub` (user_id), `iss` (`galaxify-user-service`), `aud` (`galaxify`),
  `iat`, `exp`, `email`.
- Access tokens: 15-minute lifetime. Refresh tokens: 7-day lifetime, **rotated**
  on every `POST /auth/refresh` call (old refresh token invalidated atomically
  with issuance of the new one).
- Password hashing: bcrypt at cost 12.

## Alternatives Considered

### HS256 (symmetric, shared secret)

- Pros: simplest setup — one secret in env, copy to all 4 services.
- Cons: any service holding the secret can mint tokens; a compromised non-user
  service can forge tokens for any user.
- Rejected: defeats the trust separation the architecture otherwise provides;
  not portfolio-grade.

### Opaque tokens (DB-backed)

- Pros: symmetric trust model (only User Service can validate, since it owns the
  DB); straightforward revocation.
- Cons: every request to a non-user service triggers a DB hit on `user_db` (or
  a shared auth DB); defeats the "local validation" goal.
- Rejected: hot-path DB hit on every authenticated request is the wrong shape
  for the microservice architecture.

### RS256 (asymmetric, RSA)

- Pros: textbook asymmetric JWT choice; widely supported.
- Cons: ~256+ byte signatures vs ~64 bytes for EdDSA; slower sign and verify.
- Rejected: EdDSA gives the same trust properties with smaller tokens and
  faster operations; modern Go JWT libraries (`golang-jwt/jwt/v5`) support it
  as a first-class option.

## Consequences

- All 4 services depend on User Service's `/.well-known/jwks.json` endpoint.
  Non-user services must be able to reach User Service at startup; in local
  docker-compose this is trivial; in production this is a service-discovery
  concern at deploy time.
- The `kid` mechanism is the contract between User Service's rotation cadence
  and the cache TTL on non-user services. Drift between these (e.g. rotating
  faster than 1h) is acceptable — the force-refresh path handles it.
- The 30-minute rotation transition window is sized against the 15-minute
  access-token lifetime: tokens issued with the old key can be verified for at
  least 15 minutes after rotation completes.
- Refresh tokens add a `refresh_tokens` table to `user_db` and a
  `POST /auth/refresh` endpoint. Rotation invalidates the old refresh token on
  use, limiting the blast radius of a stolen refresh token.
- Keypair bootstrap: User Service stores the Ed25519 keypair in `user_db`
  (table `jwt_keys`). On startup, User Service checks if a keypair exists; if
  not, it generates one and persists it. This avoids env var management and
  ensures all User Service instances share the same keypair without external
  secret stores. Other services remain unaware of this storage detail — they
  only depend on User Service's JWKS endpoint. For a study project, this
  trade-off (DB dependency for key storage) is acceptable; production systems
  would use a dedicated secret manager (AWS Secrets Manager, Vault, etc.).
