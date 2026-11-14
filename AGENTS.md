# Agent Configuration

Entry point for coding agents working in `galaxify-monorepo`. Keep global context small: read the linked guides in `docs/agents/` and per-app `AGENTS.md` files only when your task touches that area.

## Repository map

```
/
├── go.work                  ← Go workspace root (unites all Go modules; no root go.mod)
├── apps/
│   ├── user-service/        ← Go HTTP API (identity, EdDSA JWT, JWKS)    [apps/user-service/AGENTS.md]
│   ├── daily-service/       ← Go HTTP API (recurring dailies, history)   [apps/daily-service/AGENTS.md]
│   ├── ship-service/        ← Go HTTP API (hull health, materials)       [apps/ship-service/AGENTS.md]
│   ├── expedition-service/  ← Go HTTP API (expedition launch & results)  [apps/expedition-service/AGENTS.md]
│   └── web-frontend/        ← React/TS Vite frontend (not a Go module)   [apps/web-frontend/AGENTS.md]
├── pkg/                     ← Shared Go packages (auth, events, rabbitmq, sharedhttp, httpcontract)
├── workers/                 ← Background Go workers (daily-cron, expedition-worker)
└── docs/                    ← Specs (docs/specs/), ADRs (docs/adr/), OpenAPI (docs/openapi/), agent docs
```

## Contextual guides (`docs/agents/` & `docs/wiki/`)

Reach for these documents based on your task:

- **Agent working memory (read first before decisions)**: [`docs/wiki/index.md`](docs/wiki/index.md) — durable decisions, known pitfalls, and subsystem maps. Update it and [`docs/wiki/log.md`](docs/wiki/log.md) when something durable is learned.
- **Go services, `pkg/`, and workers**: [`docs/agents/go-services.md`](docs/agents/go-services.md) — `go.work` rules, required `go build`/`go test`/`go vet` verification, `bin/` artifact rule, handler/domain conventions (ADR-0008/0011/0012), and shared `pkg/` ADR table.
- **Web frontend (`apps/web-frontend`)**: [`docs/agents/web-frontend.md`](docs/agents/web-frontend.md) — React/TypeScript stack, feature boundaries, OpenAPI codegen, mock mode, and verification commands.
- **Domain glossary & ADRs**: [`docs/agents/domain.md`](docs/agents/domain.md) — how to use [`CONTEXT.md`](CONTEXT.md) and [`docs/adr/`](docs/adr/).
- **Issue tracker (`gh` CLI & wayfinding)**: [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).
- **Triage labels**: [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).

## Global rules & workflow discipline

- **Verify every affected module**:
  - Go changes: run `go build ./...`, `go test ./...`, and `go vet ./...` from each changed module directory (and all importers when `pkg/` changes). See [`docs/agents/go-services.md`](docs/agents/go-services.md).
  - Frontend changes: run `npm run format:check`, `npm run typecheck`, `npm run lint`, and `npm run test` from `apps/web-frontend/` (or `npm run verify` for the full gate). See [`docs/agents/web-frontend.md`](docs/agents/web-frontend.md).
- **Never commit binaries**: Always compile Go binaries into the module's gitignored `bin/` directory (`mkdir -p bin && go build -o bin/ .`), never the module or repo root.
- **Apply follow-up refinements before reporting done**: Treat user refinements in the same session as required amendments; verify they landed via `git diff` before finishing.
- **Repeated request = previous attempt failed**: If a prompt is sent verbatim twice, inspect `git status` and `git log` first and report what already landed.
