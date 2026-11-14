# User Service Agent Guide

**Location**: `apps/user-service` (repo root: [`../..`](../..), global config: [`../../AGENTS.md`](../../AGENTS.md), Go guide: [`../../docs/agents/go-services.md`](../../docs/agents/go-services.md)).

## Role

- **Scope**: Owns player identity, password credentials (argon2id via `pkg/auth`), Ed25519 signing keys (`jwt_keys`), EdDSA JWT issuance, refresh-token family rotation, and the public JWKS endpoint (`GET /.well-known/jwks.json`).
- **Port**: `:8081` (default `HTTP_ADDR`, see [`.env.example`](.env.example)).
- **Database**: `user_db` (default `postgres://postgres:password@localhost:5431/user_db`; migrations in [`sql/schema/`](sql/schema/), sqlc queries in [`sql/queries/`](sql/queries/)).
- **HTTP surface**: `GET /health`, `GET /.well-known/jwks.json`, `POST /users`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /users/me`, `PATCH /users/me`, `DELETE /users/me`.
- **Events published** (via transactional `outbox` + HTTP-triggered drainer): `user.created`, `user.deleted`.
- **Events consumed**: None (does not run a RabbitMQ subscriber).
- **Paired worker**: None.

## Contextual Docs

- Go workspace & handler conventions: [`../../docs/agents/go-services.md`](../../docs/agents/go-services.md)
- Domain glossary & working memory: [`../../CONTEXT.md`](../../CONTEXT.md), [`../../docs/wiki/index.md`](../../docs/wiki/index.md)
- Service & cross-cutting specs: [`../../docs/specs/user-service.md`](../../docs/specs/user-service.md), [`../../docs/specs/cross-cutting.md`](../../docs/specs/cross-cutting.md)
- OpenAPI contract: [`../../docs/openapi/user-service.yaml`](../../docs/openapi/user-service.yaml) ([index](../../docs/openapi/README.md))
- Key ADRs: [ADR-0002](../../docs/adr/0002-goose-sqlc-and-serve-mux.md), [ADR-0003](../../docs/adr/0003-asymmetric-jwt-eddsa-with-jwks.md), [ADR-0004](../../docs/adr/0004-transactional-outbox-http-triggered-drain.md), [ADR-0006](../../docs/adr/0006-shared-http-error-envelope-and-request-id.md), [ADR-0008](../../docs/adr/0008-handler-owned-interfaces-and-table-driven-tests.md)

## Verification

Run from `apps/user-service`:

```sh
mkdir -p bin && go build -o bin/ .
go build ./...
go test ./...
go vet ./...
go test ./internal/handler/ -run TestOpenAPIConformance -count=1
```
