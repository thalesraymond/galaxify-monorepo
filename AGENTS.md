# Agent Configuration

Entry point for coding agents working in `galaxify-monorepo`. Keep global context small: follow the pointers below when a task touches that area.

## Repository map

```
/
├── go.work                  ← Go workspace root (unites all Go modules; no root go.mod)
├── apps/
│   ├── user-service/        ← Go HTTP API (Player identity, JWT, JWKS)    [apps/user-service/AGENTS.md]
│   ├── daily-service/       ← Go HTTP API (recurring dailies, history)    [apps/daily-service/AGENTS.md]
│   ├── ship-service/        ← Go HTTP API (hull health, materials)        [apps/ship-service/AGENTS.md]
│   ├── expedition-service/  ← Go HTTP API (expedition launch & results)   [apps/expedition-service/AGENTS.md]
│   └── web-frontend/        ← React/TS Vite frontend (not a Go module)    [apps/web-frontend/AGENTS.md]
├── pkg/                     ← Shared Go library module
├── workers/                 ← Background Go workers (daily-cron, expedition-worker)
└── docs/                    ← Specs, ADRs, OpenAPI contracts, agent guides, wiki
```

## Contextual guides

- **Agent working memory (read first before decisions)**: [`docs/wiki/index.md`](docs/wiki/index.md)
- **Go services, `pkg/`, and workers**: [`docs/agents/go-services.md`](docs/agents/go-services.md)
- **Web frontend (`apps/web-frontend`)**: [`docs/agents/web-frontend.md`](docs/agents/web-frontend.md)
- **Domain glossary & ADRs**: [`docs/agents/domain.md`](docs/agents/domain.md)
- **Issue tracker (`gh` CLI & wayfinding)**: [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)
- **Triage labels**: [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md)

## Global rules

- **Work on a topic branch**: Before making changes or committing, check the current branch. If the worktree is on `main`, create and switch to an appropriately named `feat/`, `fix/`, `refactor/`, `docs/`, or other task branch. Never commit directly to local `main`.
- **Verify every affected module**: Before reporting done, run the verification checks documented in the contextual guide for every changed module (and all dependents when `pkg/` changes).
- **Keep Go binaries in `bin/`**: Compile service/worker binaries into each module's gitignored `bin/` directory; keep binaries out of git commits.
- **Apply follow-up refinements**: Treat user refinements in the same session as required amendments and confirm they landed via `git diff`.
- **Inspect history on repeated prompts**: If the same prompt arrives verbatim twice, inspect `git status` and `git log` first and report what already landed.

## Worker integration tests

The workers carry `//go:build integration` tests that exercise `Tick` + `NewPgStore` against a real PostgreSQL. Each test spins up a private `initdb` cluster on a Unix socket in a temp dir (no TCP, no shared DB, no `DATABASE_URL`). Shared cluster/migration/commit-gate helpers live in `pkg/pgtest` (also build-tagged `integration`).

**Prerequisites**: `initdb` and `pg_ctl` on `PATH` (a PostgreSQL server install), running as a non-root user. Missing tools fail the tests loudly rather than skipping.

```bash
(cd workers/daily-cron        && go test -tags=integration ./internal/cron -count=1)
(cd workers/expedition-worker && go test -tags=integration ./internal/expedition -count=1)
```
