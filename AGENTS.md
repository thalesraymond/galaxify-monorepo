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