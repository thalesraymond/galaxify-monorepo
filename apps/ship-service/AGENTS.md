# Ship Service Agent Guide

**Location**: `apps/ship-service` (repo root: [`../..`](../..)).

## Role

- **Scope**: Owns each Player's persistent Ship (`hull_health`, `materials_balance`, `level`) and hull repair transactions. Config defaults live in [`.env.example`](.env.example); schema and sqlc queries live in [`sql/`](sql/).
- **Events**: Consumes `user.created`, `daily.completed`, `daily.missed`, `expedition.launched`, and `expedition.completed`; publishes `ship.status_updated` via transactional `outbox` (skipped on initial `user.created` provisioning).

## Contextual Docs

- Global & Go rules: [`../../AGENTS.md`](../../AGENTS.md), [`../../docs/agents/go-services.md`](../../docs/agents/go-services.md)
- Domain & workflow docs: [`../../docs/agents/domain.md`](../../docs/agents/domain.md), [`../../docs/agents/issue-tracker.md`](../../docs/agents/issue-tracker.md), [`../../CONTEXT.md`](../../CONTEXT.md), [`../../docs/wiki/index.md`](../../docs/wiki/index.md)
- Service spec & OpenAPI contract: [`../../docs/specs/ship-service.md`](../../docs/specs/ship-service.md), [`../../docs/openapi/ship-service.yaml`](../../docs/openapi/ship-service.yaml)

## Verification

Run the Go build, test, vet, `bin/`, and `TestOpenAPIConformance` checks from this directory per the Go guide above.
