# Expedition Service Agent Guide

**Location**: `apps/expedition-service` (repo root: [`../..`](../..)).

## Role

- **Scope**: Owns Expedition quotes, launch validation (active expedition, cooldown, and cached materials balance against `user_ship_state_cache`; cached `hull_health` scales `success_chance`), expedition reads, and `expedition_results`. Config defaults live in [`.env.example`](.env.example); schema and sqlc queries live in [`sql/`](sql/).
- **Events**: Consumes `user.created` and `ship.status_updated` (`user_ship_state_cache`); publishes `expedition.launched` via transactional `outbox`.
- **Paired worker**: [`../../workers/expedition-worker`](../../workers/expedition-worker) shares `expedition_db` (its `sql/schema/schema.sql` mirrors [`sql/schema/`](sql/schema/)), resolves due `IN_FLIGHT` expeditions, records `expedition_results`, and stages/drains `expedition.completed`.

## Contextual Docs

- Global & Go rules: [`../../AGENTS.md`](../../AGENTS.md), [`../../docs/agents/go-services.md`](../../docs/agents/go-services.md)
- Domain & workflow docs: [`../../docs/agents/domain.md`](../../docs/agents/domain.md), [`../../docs/agents/issue-tracker.md`](../../docs/agents/issue-tracker.md), [`../../CONTEXT.md`](../../CONTEXT.md), [`../../docs/wiki/index.md`](../../docs/wiki/index.md)
- Service spec & OpenAPI contract: [`../../docs/specs/expedition-service.md`](../../docs/specs/expedition-service.md), [`../../docs/openapi/expedition-service.yaml`](../../docs/openapi/expedition-service.yaml)
- Service ADRs: [ADR-0007](../../docs/adr/0007-separate-background-workers.md), [ADR-0013](../../docs/adr/0013-expedition-outbox-ownership.md) (cross-cutting specs and shared ADRs live in `go-services.md`)

## Verification

Run the Go build, test, vet, `bin/`, and `TestOpenAPIConformance` checks from this directory per the Go guide above. Also verify `../../workers/expedition-worker` whenever `expedition_db` schema, shared queries, or resolution/outbox contracts change.
