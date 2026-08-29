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

Scaffold stage — workspace, local infrastructure, and per-service connectivity
are in place; no business functionality implemented yet. Each Go service loads
`apps/<service>/.env` (see `docker-compose.yml` for the local infrastructure)
and verifies its PostgreSQL connection and the RabbitMQ broker at startup.

## Local development

```sh
docker compose up -d    # 4x Postgres + 1x RabbitMQ
cd apps/user-service && go run .   # connects to user_db + RabbitMQ, exits 0 on success
```

See `CONTEXT.md` and `docs/adr/` for decisions and context.