# Daily Service Agent Guide

**Location**: `apps/daily-service` (repo root: [`../..`](../..), global config: [`../../AGENTS.md`](../../AGENTS.md), Go guide: [`../../docs/agents/go-services.md`](../../docs/agents/go-services.md)).

## Role

- **Scope**: Owns recurring Daily task definitions, IANA time-zone deadline scheduling, completion transitions, backend-owned difficulty reward/damage metadata, and archival completion/miss history (`daily_history`).
- **Port**: `:8082` (default `HTTP_ADDR`, see [`.env.example`](.env.example)); verifies EdDSA JWTs against `user-service` JWKS (`JWKS_URL`).
- **Database**: `daily_db` (default `postgres://postgres:password@localhost:5432/daily_db`; authoritative migrations in [`sql/schema/`](sql/schema/), sqlc queries in [`sql/queries/`](sql/queries/)).
- **HTTP surface**: `GET /health`, `POST /dailies`, `GET /dailies`, `GET /dailies/history`, `GET /dailies/difficulties`, `GET /dailies/{id}`, `PATCH /dailies/{id}`, `DELETE /dailies/{id}`, `POST /dailies/{id}/complete`.
- **Events published** (via transactional `outbox` + HTTP-triggered drainer): `daily.completed` (on `POST /dailies/{id}/complete`). Paired worker publishes `daily.missed`.
- **Events consumed** (idempotent consumer via `processed_events`): `user.created` (provisions `users_cache`), `user.deleted` (deletes `users_cache` / cascades user data).
- **Paired worker**: [`../../workers/daily-cron`](../../workers/daily-cron) — shares `daily_db` (its `sql/schema/schema.sql` mirrors `sql/schema/` here), sweeps expired dailies, archives missed cycles, advances due dates, and stages/drains `daily.missed`. Verify `daily-cron` as well when changing `daily_db` schemas or Daily rollover/event contracts.

## Contextual Docs

- Go workspace & handler conventions: [`../../docs/agents/go-services.md`](../../docs/agents/go-services.md)
- Domain glossary & working memory: [`../../CONTEXT.md`](../../CONTEXT.md), [`../../docs/wiki/index.md`](../../docs/wiki/index.md)
- Service & cross-cutting specs: [`../../docs/specs/daily-service.md`](../../docs/specs/daily-service.md), [`../../docs/specs/cross-cutting.md`](../../docs/specs/cross-cutting.md), [`../../docs/specs/idempotent-consumer-pipeline.md`](../../docs/specs/idempotent-consumer-pipeline.md)
- OpenAPI contract: [`../../docs/openapi/daily-service.yaml`](../../docs/openapi/daily-service.yaml) ([index](../../docs/openapi/README.md))
- Key ADRs: [ADR-0002](../../docs/adr/0002-goose-sqlc-and-serve-mux.md), [ADR-0004](../../docs/adr/0004-transactional-outbox-http-triggered-drain.md), [ADR-0007](../../docs/adr/0007-separate-background-workers.md), [ADR-0008](../../docs/adr/0008-handler-owned-interfaces-and-table-driven-tests.md), [ADR-0010](../../docs/adr/0010-idempotent-consumer-pipeline.md), [ADR-0011](../../docs/adr/0011-domain-lifecycle-modules-and-deep-seams.md), [ADR-0012](../../docs/adr/0012-recurring-daily-lifecycle-and-archival-rollover.md)

## Verification

Run from `apps/daily-service`:

```sh
mkdir -p bin && go build -o bin/ .
go build ./...
go test ./...
go vet ./...
go test ./internal/handler/ -run TestOpenAPIConformance -count=1
```

If `daily_db` schema, shared queries, or Daily rollover events changed, also run `go build ./...`, `go test ./...`, and `go vet ./...` from [`../../workers/daily-cron`](../../workers/daily-cron).
