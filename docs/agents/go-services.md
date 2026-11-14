# Go Services & Workspace Conventions

This guide applies to every Go module in the workspace (`apps/*-service`, `pkg/`, and `workers/*`). The repo root is `../..` from this directory.

## Go workspace (`go.work`)

This is a **Go workspace monorepo** (see [ADR-0001](../adr/0001-go-workspace-monorepo.md)). Each module has its own `go.mod` and the committed root `go.work` unites them (no root `go.mod`):

- `apps/user-service`, `apps/daily-service`, `apps/ship-service`, `apps/expedition-service` — HTTP API services
- `pkg` — shared library module
- `workers/daily-cron`, `workers/expedition-worker` — background workers

Rules:
- Add a module by adding a directory with a `go.mod` and one line in `go.work` — **never** use a `replace` directive.
- A change in `pkg/` affects every module that imports it; verify `pkg/` and all dependent modules.
- `gopls` sees the full module map via `go.work`.

## Required verification (`go build` / `go test` / `go vet`)

Every change to a Go module must be verified from each affected module directory (and `pkg/` plus its importers when `pkg/` changes):

```sh
cd apps/<service>        # or pkg, or workers/<worker>
go build ./...
go test  ./...
go vet   ./...
```

When modifying HTTP handlers, routes, or OpenAPI contracts, also run the conformance suite from the service or repo root:

```sh
go test ./internal/handler/ -run TestOpenAPIConformance -count=1
# or from repo root: make openapi-validate && make openapi-check
```

Keep repo-root `Makefile` targets (`make test`, `make vet`) covering `pkg/` alongside every service and worker.

## Build artifacts

- Compile binaries into each module's gitignored `bin/` folder (`mkdir -p bin && go build -o bin/ .`), **never** to the module root or repo root.
- Remove any stray binary appearing in `git status` before committing.

## Code conventions

- **Reuse `pkg/` first**: Check existing packages under `pkg/` before writing service-local helpers; extract a new shared package into `pkg/` only when duplicating across two or more services.
- **Name symbols with domain context**: Include the domain in package-level constructors and helpers (e.g., `NewDailyApiHandler`, `LoggerBuilder`).

## Handler and domain conventions

Read [ADR-0008](../adr/0008-handler-owned-interfaces-and-table-driven-tests.md), [ADR-0011](../adr/0011-domain-lifecycle-modules-and-deep-seams.md), and [ADR-0012](../adr/0012-recurring-daily-lifecycle-and-archival-rollover.md) before writing or reviewing handler and domain code:

- Handlers depend on **high-leverage domain interfaces** (e.g., `daily.Manager`), never raw SQL queries or multi-step database orchestration.
- Handlers expose a `RegisterXRoutes(*http.ServeMux)` method so tests exercise the real route table.
- Tests use package-local helpers (`newTestXHandler`, `newTestXRouter`, `newTestRequest`, `wantStatus`, `decodeBody`, etc.) and table-driven cases.
- Tests assert both the HTTP response and the parameters passed to the domain mock.

## Shared infrastructure (`pkg/`)

The on-the-wire contract lives in [`docs/specs/cross-cutting.md`](../specs/cross-cutting.md); the core implementations live in [`errors.go`](../../pkg/sharedhttp/errors.go), [`middleware.go`](../../pkg/sharedhttp/middleware.go), and [`pkg/auth/`](../../pkg/auth/). Read the relevant ADR before touching cross-cutting subsystems:

| Subsystem | ADR | Read when… |
| --- | --- | --- |
| `pkg/sharedhttp` — error envelope, request ID middleware, auth middleware | [ADR-0006](../adr/0006-shared-http-error-envelope-and-request-id.md) | writing/modifying HTTP handlers, adding error codes, wiring middleware in `main.go` |
| `pkg/auth` — EdDSA JWT, JWKS cache, password hashing, refresh tokens | [ADR-0003](../adr/0003-asymmetric-jwt-eddsa-with-jwks.md) | working on auth flows, login/signup/refresh, JWT verification |
| `pkg/events` & `pkg/rabbitmq` — event bus topology, envelope, outbox, DLX/AE, idempotent consumer pipeline | [ADR-0004](../adr/0004-transactional-outbox-http-triggered-drain.md), [ADR-0005](../adr/0005-galaxify-event-bus-topology.md), [ADR-0009](../adr/0009-dead-letter-and-alternate-exchanges.md), [ADR-0010](../adr/0010-idempotent-consumer-pipeline.md) | emitting or consuming events, designing new event types, declaring queues, writing consumers |
