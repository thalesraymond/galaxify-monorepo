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

See `CONTEXT.md` and `docs/adr/` for decisions and context.