# Agent configuration

This file is the entry point for coding agents (OpenCode, Claude Code, etc.)
working in this repo.

## Repository structure (Go workspace monorepo)

This is a **Go workspace monorepo** (see `docs/adr/0001-go-workspace-monorepo.md`).
There is no single root `go.mod`; instead each module has its own `go.mod` and the
root `go.work` (committed) unites them:

```
/
├── go.work                  ← workspace root, lists all Go modules
├── docker-compose.yml       ← local infrastructure
├── apps/
│   ├── daily-service/       ← Go module (HTTP API)
│   ├── expedition-service/  ← Go module (HTTP API)
│   ├── ship-service/        ← Go module (HTTP API)
│   ├── user-service/        ← Go module (HTTP API)
│   └── web-frontend/        ← frontend, NO Go module
├── pkg/                     ← shared code Go module (events, rabbitmq)
└── workers/                 ← background workers and crons (Lambdas/Functions)
    └── daily-cron/          ← Go module (Missed dailies worker)
```

- Add a service by adding a directory with a `go.mod` and one line in `go.work`
  — never a `replace` directive (the workspace resolves local modules directly).
- A change in `pkg/` affects every module that imports it; verify all of them.
- `apps/web-frontend/` is not part of the Go workspace; Go commands there are a no-op.
- gopls sees the full module map via `go.work`, so cross-module navigation works from the repo root.

## Required verification (go build / test / vet)

Every agentic change must be verified with **`go build`**, **`go test`**, and
**`go vet`** for **every module containing changed code** (and any module that
imports changed `pkg/` code). Run them from each affected module directory:

```sh
cd apps/<service>        # or pkg, per affected module
go build ./...
go test  ./...
go vet   ./...
```

This includes `pkg/` itself, even when only one service depends on it: a
change in `pkg/` affects every module that imports it, so run the three
commands there too, and keep the repo-root `Makefile` targets (`make test`,
`make coverage`, `make vet`, …) covering `pkg/` so a single command exercises
every module.

(The repo root has no `go.mod`, so `go build ./...` from the root does not
work; run the three commands per module instead. gopls sees the full module
map via `go.work`.)

## Build artifacts (never commit binaries)

- **Always** write compiled binaries to the module's local `bin/` folder —
  **never** to the module root or anywhere else in the tree.
- **Never commit binaries.** `bin/` is gitignored. A binary that shows up in
  `git status` outside `bin/` is a mistake: remove it before committing — do
  not `git add` it, do not `git commit` it.

```sh
cd apps/<service>          # or any module with a main package
mkdir -p bin
go build -o bin/ .         # writes bin/<service>
```

A change is not done until the build/test/vet checks above pass with no
failures.

## Workflow discipline

- **Apply follow-up refinements before reporting done**: When the user refines
  or corrects a previous request in the same session (e.g. "the test command
  should use `-race`"), treat it as an amendment, not a new suggestion. Verify
  the refinement actually landed in the code (`grep`, `git diff`) before
  finishing — if it didn't, apply it or report it as unfinished. Never mark a
  change done when a requested follow-up is still pending.
- **Repeated request = previous attempt failed**: If the user re-sends the same
  request verbatim (identical prompt sent twice), the earlier attempt likely
  did not complete. Before redoing the work, check `git status` and
  `git log` to see whether part of it already landed, and tell the user what
  you found.

## Code conventions

- **Check `pkg/` before writing any service helper**: When a service needs a
  helper function (JSON encoding, error helpers, logging, etc.), first check
  whether an equivalent already exists in a shared `pkg/` module — reuse it
  instead of recreating it in the service. Only create a new shared piece of
  code in `pkg/` (under a proper module) when a helper is being duplicated
  across two or more services.
- **Name things with context**: instead of generic names like `NewHandler` or
  `Builder`, include the domain in the name — better names: `NewDailyApiHandler`,
  `LoggerBuilder`. Since Go functions are "loose" (package-level), names are
  very important.

## Handler testing conventions

HTTP handler tests follow the contract in
[ADR-0008](docs/adr/0008-handler-owned-interfaces-and-table-driven-tests.md):

- Handlers depend on a **narrow, handler-owned store interface** (e.g.
  `authStore`), never the full generated `database.Querier`.
- Handlers expose a `RegisterXRoutes(*http.ServeMux)` method so tests can
  exercise the real route table.
- Tests use package-local helpers (`newTestXHandler`, `newTestXRouter`,
  `newTestRequest`, `wantStatus`, `decodeBody`, etc.) and table-driven cases.
- Tests assert both the HTTP response and the parameters passed to the store
  mock.

Read ADR-0008 before writing or reviewing handler tests.

## Shared infrastructure (cross-cutting `pkg/`)

The cross-cutting subsystems (`pkg/sharedhttp`, `pkg/auth`, `pkg/events`,
`pkg/rabbitmq`) implement foundational decisions that affect every service.
Each subsystem has an ADR recording the design rationale and the contract —
read the ADR before touching the corresponding code.

| Subsystem                                                                 | ADR                                                                                                                              | Read when…                                                                          |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pkg/sharedhttp` — error envelope, request ID middleware, auth middleware | [ADR-0006](docs/adr/0006-shared-http-error-envelope-and-request-id.md)                                                           | writing/modifying HTTP handlers, adding error codes, wiring middleware in `main.go` |
| `pkg/auth` — EdDSA JWT, JWKS cache, password hashing, refresh tokens      | [ADR-0003](docs/adr/0003-asymmetric-jwt-eddsa-with-jwks.md)                                                                      | working on auth flows, login/signup/refresh, JWT verification                       |
| `pkg/events` — event bus topology, envelope, outbox pattern               | [ADR-0004](docs/adr/0004-transactional-outbox-http-triggered-drain.md), [ADR-0005](docs/adr/0005-galaxify-event-bus-topology.md) | emitting or consuming events, designing new event types, declaring queues           |

The implementation contract and on-the-wire shapes live in
[`docs/specs/cross-cutting.md`](docs/specs/cross-cutting.md); the
implementation itself lives under each `pkg/` module
([errors.go](pkg/sharedhttp/errors.go), [middleware.go](pkg/sharedhttp/middleware.go),
[auth/\*](pkg/auth)).

## Agent skills

### Issue tracker

Issues and specs for this repo live as GitHub issues, operated via the `gh`
CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default five labels: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See
`docs/agents/domain.md`.
