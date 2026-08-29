# ADR-0001: Go workspace monorepo

- **Status:** Accepted
- **Date:** 2026-08-29
- **Source:** project planning notes (Boot.dev final project, Galaxify)

## Context

Galaxify will be built as multiple Go microservices sharing a small amount of
common code (message contracts, RabbitMQ client wrapper). The repo will also
contain a frontend. A single root `go.mod` would force every service to pull
every dependency and blur service boundaries for tooling.

## Decision

Use a Go workspace monorepo:

- one `go.mod` per module, under `apps/<service>/` for each Go service and
  under `pkg/` for shared code;
- a root `go.work` (committed) that unites all modules;
- `docker-compose.yml` at the root for local infrastructure;
- the frontend lives under `apps/web-frontend/` (no Go module);
- no `replace` directives — the workspace resolves local modules directly.

## Consequences

- Each service keeps a lean dependency graph; Docker builds copy only the
  service folder and `pkg/`.
- gopls, agents, and CI read `go.work` and see the full module map.
- Adding a service = adding a directory, a `go.mod`, and one line in
  `go.work`.