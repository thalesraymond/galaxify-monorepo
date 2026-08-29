# Galaxify Monorepo

Final project for the Boot.dev backend track: a space-themed daily-task
tracker ("mini Habitica") built as a Go workspace monorepo of event-driven
microservices, each with its own isolated PostgreSQL database, connected by a
RabbitMQ message bus.

## Structure

```
.
├── apps/
│   ├── user-service        # Auth & players
│   ├── daily-service       # Daily tasks
│   ├── ship-service        # Ship state
│   ├── expedition-service  # Weekly expeditions
│   └── web-frontend        # Frontend placeholder (tech TBD)
├── pkg/
│   ├── events/             # Shared message-bus event contracts
│   └── rabbitmq/           # Shared RabbitMQ client wrapper
├── docs/
│   ├── agents/             # Agent skill configuration
│   └── adr/                # Architecture decision records
├── docker-compose.yml      # Local infra: 4x Postgres + 1x RabbitMQ
├── go.work                 # Go workspace uniting all modules
└── CONTEXT.md              # Project context
```

## Status

Scaffold stage — workspace, local infrastructure, per-service connectivity, and
the HTTP server shell are in place; no business functionality implemented yet.
Each Go service loads `apps/<service>/.env` (see `docker-compose.yml` for the
local infrastructure), verifies its PostgreSQL connection and the RabbitMQ
broker at startup, then serves its HTTP API — `GET /health` for now — until it
receives SIGINT/SIGTERM (see ADR-0002).

## Local development

```sh
docker compose up -d                     # 4x Postgres + 1x RabbitMQ
cd apps/user-service && go run .          # serves HTTP on :8081
curl localhost:8081/health                # {"status":"ok","service":"user-service"}
```

Each service listens on its own HTTP port
(`user-service` :8081, `daily-service` :8082, `ship-service` :8083,
`expedition-service` :8084); overridable via `HTTP_ADDR` in the service's
`.env`.

## Commands (Makefile)

The root [`Makefile`](Makefile) runs the per-service tooling for **all**
services at once (user, daily, ship, expedition) from the repo root — no need
to `cd` into each service. `goose-up`/`goose-down` require the local
infrastructure to be up (`docker compose up -d`); `sqlc`, `build`, and `vet`
require `sqlc` and `go` on the `PATH` respectively. Run `make help` to list
all targets.

| Command           | What it does                                                       |
| ----------------- | ------------------------------------------------------------------ |
| `make test`       | `go test ./...` in every service                                   |
| `make coverage`   | `go test -cover ./...` in every service                            |
| `make goose-up`   | `goose up` in every service (applies `sql/schema` migrations)      |
| `make goose-down` | `goose down` in every service (rolls back one migration)           |
| `make sqlc`       | `sqlc generate` in every service (regenerates `internal/database`) |
| `make build`      | `go build` every service into `apps/<service>/bin/`                |
| `make vet`        | `go vet ./...` in every service **and** `pkg/`                     |
| `make fmt`        | `gofmt -w` on every `.go` file in the repo                         |
| `make tidy`       | `go mod tidy` in every module (services + `pkg/`)                  |
| `make help`       | List all targets with descriptions                                 |

Two commands take extra care:

- **`make build`** writes each binary to the module-local `bin/` folder
  (gitignored) — never to the module root — so nothing compiled ever ends up
  committed.
- **`make vet`** also covers `pkg/`, since a change there affects every module
  that imports it.

See `CONTEXT.md` and `docs/adr/` for decisions and context.
