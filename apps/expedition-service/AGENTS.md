# Expedition Service Agent Guide

**Location**: `apps/expedition-service` (repo root: [`../..`](../..), global config: [`../../AGENTS.md`](../../AGENTS.md), Go guide: [`../../docs/agents/go-services.md`](../../docs/agents/go-services.md)).

## Role

- **Scope**: Owns Expedition quotes, launch validation (active expedition, cooldown, and cached materials/hull checks against `user_ship_state_cache`), expedition reads, and outcome tracking (`expedition_results`).
- **Port**: `:8084` (default `HTTP_ADDR`, see [`.env.example`](.env.example)); verifies EdDSA JWTs against `user-service` JWKS (`JWKS_URL`).
- **Database**: `expedition_db` (default `postgres://postgres:password@localhost:5434/expedition_db`; authoritative migrations in [`sql/schema/`](sql/schema/), sqlc queries in [`sql/queries/`](sql/queries/)).
- **HTTP surface**: `GET /health`, `POST /expeditions/launch`, `GET /expeditions/current`, `GET /expeditions/quote`, `GET /expeditions/{id}`, `GET /expeditions`.
- **Events published** (via transactional `outbox` + HTTP-triggered drainer): `expedition.launched` (on `POST /expeditions/launch`). Paired worker publishes `expedition.completed`.
- **Events consumed** (idempotent consumers via `processed_events`): `user.created` (seeds `user_ship_state_cache`), `ship.status_updated` (updates `user_ship_state_cache`).
- **Paired worker**: [`../../workers/expedition-worker`](../../workers/expedition-worker) — shares `expedition_db` (its `sql/schema/schema.sql` mirrors `sql/schema/` here), resolves due `IN_FLIGHT` expeditions, records `expedition_results`, and stages/drains `expedition.completed`. Verify `expedition-worker` as well when changing `expedition_db` schemas, resolution logic, or outbox/event contracts.

## Contextual Docs

- Go workspace & handler conventions: [`../../docs/agents/go-services.md`](../../docs/agents/go-services.md)
- Domain glossary & working memory: [`../../CONTEXT.md`](../../CONTEXT.md), [`../../docs/wiki/index.md`](../../docs/wiki/index.md)
- Service & cross-cutting specs: [`../../docs/specs/expedition-service.md`](../../docs/specs/expedition-service.md), [`../../docs/specs/cross-cutting.md`](../../docs/specs/cross-cutting.md), [`../../docs/specs/idempotent-consumer-pipeline.md`](../../docs/specs/idempotent-consumer-pipeline.md)
- OpenAPI contract: [`../../docs/openapi/expedition-service.yaml`](../../docs/openapi/expedition-service.yaml) ([index](../../docs/openapi/README.md))
- Key ADRs: [ADR-0002](../../docs/adr/0002-goose-sqlc-and-serve-mux.md), [ADR-0004](../../docs/adr/0004-transactional-outbox-http-triggered-drain.md), [ADR-0007](../../docs/adr/0007-separate-background-workers.md), [ADR-0008](../../docs/adr/0008-handler-owned-interfaces-and-table-driven-tests.md), [ADR-0010](../../docs/adr/0010-idempotent-consumer-pipeline.md), [ADR-0011](../../docs/adr/0011-domain-lifecycle-modules-and-deep-seams.md), [ADR-0013](../../docs/adr/0013-expedition-outbox-ownership.md)

## Verification

Run from `apps/expedition-service`:

```sh
mkdir -p bin && go build -o bin/ .
go build ./...
go test ./...
go vet ./...
go test ./internal/handler/ -run TestOpenAPIConformance -count=1
```

If `expedition_db` schema, shared queries, or resolution/outbox contracts changed, also run `go build ./...`, `go test ./...`, and `go vet ./...` from [`../../workers/expedition-worker`](../../workers/expedition-worker).
