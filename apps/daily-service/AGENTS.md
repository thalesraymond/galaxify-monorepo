# Daily Service Agent Guide

**Location**: `apps/daily-service` (repo root: [`../..`](../..)).

## Role

- **Scope**: Owns recurring Daily tasks, IANA time-zone deadline scheduling, completion transitions, difficulty reward/damage metadata, and `daily_history` archival. Config defaults live in [`.env.example`](.env.example); schema and sqlc queries live in [`sql/`](sql/).
- **Events**: Consumes `user.created` and `user.deleted` (`users_cache`); publishes `daily.completed` via transactional `outbox`.
- **Paired worker**: [`../../workers/daily-cron`](../../workers/daily-cron) shares `daily_db` (its `sql/schema/schema.sql` mirrors [`sql/schema/`](sql/schema/)), sweeps expired dailies, archives missed cycles, advances due dates, and stages/drains `daily.missed`.

## Contextual Docs

- Global & Go rules: [`../../AGENTS.md`](../../AGENTS.md), [`../../docs/agents/go-services.md`](../../docs/agents/go-services.md)
- Domain & workflow docs: [`../../docs/agents/domain.md`](../../docs/agents/domain.md), [`../../docs/agents/issue-tracker.md`](../../docs/agents/issue-tracker.md), [`../../CONTEXT.md`](../../CONTEXT.md), [`../../docs/wiki/index.md`](../../docs/wiki/index.md)
- Service spec & OpenAPI contract: [`../../docs/specs/daily-service.md`](../../docs/specs/daily-service.md), [`../../docs/openapi/daily-service.yaml`](../../docs/openapi/daily-service.yaml)
- Worker ADR: [ADR-0007](../../docs/adr/0007-separate-background-workers.md) (cross-cutting specs and shared handler/consumer/rollover ADRs live in `go-services.md`)

## Verification

Run the Go build, test, vet, `bin/`, and `TestOpenAPIConformance` checks from this directory per the Go guide above. Also verify `../../workers/daily-cron` whenever `daily_db` schema, shared queries, or rollover/event contracts change.
