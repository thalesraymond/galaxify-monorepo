# User Service Agent Guide

**Location**: `apps/user-service` (repo root: [`../..`](../..)).

## Role

- **Scope**: Owns Player identity, password credentials (`pkg/auth`), Ed25519 signing keys (`jwt_keys`), EdDSA JWT issuance, refresh-token family rotation, and the public JWKS endpoint. Config defaults live in [`.env.example`](.env.example); schema and sqlc queries live in [`sql/`](sql/).
- **Events published** (via transactional `outbox` + HTTP-triggered drainer): `user.created`, `user.deleted`.

## Contextual Docs

- Global & Go rules: [`../../AGENTS.md`](../../AGENTS.md), [`../../docs/agents/go-services.md`](../../docs/agents/go-services.md)
- Domain & workflow docs: [`../../docs/agents/domain.md`](../../docs/agents/domain.md), [`../../docs/agents/issue-tracker.md`](../../docs/agents/issue-tracker.md), [`../../CONTEXT.md`](../../CONTEXT.md), [`../../docs/wiki/index.md`](../../docs/wiki/index.md)
- Service spec & OpenAPI contract: [`../../docs/specs/user-service.md`](../../docs/specs/user-service.md), [`../../docs/openapi/user-service.yaml`](../../docs/openapi/user-service.yaml)
- Service ADR: [ADR-0002](../../docs/adr/0002-goose-sqlc-and-serve-mux.md) (cross-cutting specs and shared ADRs live in `go-services.md`)

## Verification

Run the Go build, test, vet, `bin/`, and `TestOpenAPIConformance` checks from this directory per the Go guide above.
