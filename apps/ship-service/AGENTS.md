# Ship Service Agent Guide

**Location**: `apps/ship-service` (repo root: [`../..`](../..), global config: [`../../AGENTS.md`](../../AGENTS.md), Go guide: [`../../docs/agents/go-services.md`](../../docs/agents/go-services.md)).

## Role

- **Scope**: Owns each Player's persistent Ship state (`hull_health`, `materials_balance`, `level`) and hull repair transactions.
- **Port**: `:8083` (default `HTTP_ADDR`, see [`.env.example`](.env.example)); verifies EdDSA JWTs against `user-service` JWKS (`JWKS_URL`).
- **Database**: `ship_db` (default `postgres://postgres:password@localhost:5433/ship_db`; migrations in [`sql/schema/`](sql/schema/), sqlc queries in [`sql/queries/`](sql/queries/)).
- **HTTP surface**: `GET /health`, `GET /ships/me`, `POST /ships/repair`.
- **Events published** (via transactional `outbox`): `ship.status_updated` (emitted on `POST /ships/repair` and after state-mutating `daily.completed`, `daily.missed`, `expedition.launched`, and successful `expedition.completed` consumers; initial `user.created` provisioning does not emit it).
- **Events consumed** (idempotent consumers via `processed_events`): `user.created`, `daily.completed`, `daily.missed`, `expedition.launched`, `expedition.completed`.
- **Paired worker**: None.

## Contextual Docs

- Go workspace & handler conventions: [`../../docs/agents/go-services.md`](../../docs/agents/go-services.md)
- Domain glossary & working memory: [`../../CONTEXT.md`](../../CONTEXT.md), [`../../docs/wiki/index.md`](../../docs/wiki/index.md)
- Service & cross-cutting specs: [`../../docs/specs/ship-service.md`](../../docs/specs/ship-service.md), [`../../docs/specs/cross-cutting.md`](../../docs/specs/cross-cutting.md), [`../../docs/specs/idempotent-consumer-pipeline.md`](../../docs/specs/idempotent-consumer-pipeline.md)
- OpenAPI contract: [`../../docs/openapi/ship-service.yaml`](../../docs/openapi/ship-service.yaml) ([index](../../docs/openapi/README.md))
- Key ADRs: [ADR-0002](../../docs/adr/0002-goose-sqlc-and-serve-mux.md), [ADR-0004](../../docs/adr/0004-transactional-outbox-http-triggered-drain.md), [ADR-0005](../../docs/adr/0005-galaxify-event-bus-topology.md), [ADR-0008](../../docs/adr/0008-handler-owned-interfaces-and-table-driven-tests.md), [ADR-0009](../../docs/adr/0009-dead-letter-and-alternate-exchanges.md), [ADR-0010](../../docs/adr/0010-idempotent-consumer-pipeline.md), [ADR-0011](../../docs/adr/0011-domain-lifecycle-modules-and-deep-seams.md)

## Verification

Run from `apps/ship-service`:

```sh
mkdir -p bin && go build -o bin/ .
go build ./...
go test ./...
go vet ./...
go test ./internal/handler/ -run TestOpenAPIConformance -count=1
```
