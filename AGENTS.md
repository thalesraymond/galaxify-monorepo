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
│   ├── daily-service/       ← Go module
│   ├── expedition-service/  ← Go module
│   ├── ship-service/        ← Go module
│   ├── user-service/        ← Go module
│   └── web-frontend/        ← frontend, NO Go module
└── pkg/                     ← shared code Go module (events, rabbitmq)
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

Alternatively, from the repo root, `go build ./...`, `go test ./...`, and
`go vet ./...` cover the whole workspace in one pass. A change is not done
until all three pass with no failures.

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