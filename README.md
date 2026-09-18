# Galaxify

Galaxify is a space-themed daily-task game built for the Boot.dev backend
track. Players complete recurring dailies to earn ship materials, miss dailies
and take hull damage, repair their ship, and eventually invest materials in
weekly expeditions.

The product is a React frontend backed by independently deployable Go services.
Each service owns a PostgreSQL database and communicates through a RabbitMQ
topic exchange.

## Project status

Phase 1 is complete. The full Player loop is available locally: sign up, manage
recurring Dailies, observe Ship material and hull changes, repair, launch an
Expedition, and follow it to resolution. The React application supports both
the real local stack and deterministic MSW scenarios.

| Component | Current implementation |
| --- | --- |
| User Service | Signup, login, refresh-token rotation and reuse detection, EdDSA access tokens, JWKS, authenticated profile read/update/delete, and `user.created` / `user.deleted` publication |
| Daily Service | Authenticated daily CRUD, completion, history, recurring lifecycle, user-cache consumers, and `daily.completed` publication |
| Daily Cron | Five-minute missed/completed sweep, archival history, deadline rollover, and `daily.missed` publication |
| Ship Service | Default-ship provisioning, idempotent Daily and Expedition event consumers, authenticated Ship status and repair, and `ship.status_updated` publication |
| Expedition Service | Player and Ship projections, authenticated launch/current/history/detail/quote APIs, and `expedition.launched` publication |
| Expedition Worker | Resolves due Expeditions and publishes `expedition.completed` |
| Web frontend | React 19/Vite Player experience with typed OpenAPI contracts, real and MSW modes, automated accessibility, visual, cross-browser, E2E, and performance gates |

Every publishing service stages its state mutation and outbox record in the
same database transaction. The shared outbox drainer publishes those records
at least once; idempotent consumers apply their deduplication record and domain
mutation in one transaction. Service outboxes drain after HTTP requests, so a
pending service event can wait for a subsequent request; worker outboxes drain
on their scheduled ticks.

The authoritative product and delivery documents are:

- [Phase 1 product specification](docs/specs/web-frontend.md)
- [Phase 1 delivery specification](docs/specs/web-frontend-delivery.md)
- [Frontend application guide](apps/web-frontend/README.md)
- [OpenAPI contracts](docs/openapi/README.md)
- [Phase 1 release evidence](docs/specs/web-frontend-phase1-release-evidence.md)
- [Accessibility checklist](docs/specs/web-frontend-accessibility-checklist.md)

## Architecture

The committed [`go.work`](go.work) joins seven Go modules:

```text
.
├── apps/
│   ├── user-service/        # Accounts, sessions, signing keys, JWKS
│   ├── daily-service/       # Recurring dailies and history
│   ├── ship-service/        # Ship hull, materials, and repair
│   ├── expedition-service/  # Expedition launch and read APIs
│   └── web-frontend/        # React/Vite frontend; not a Go module
├── pkg/
│   ├── auth/                # EdDSA JWT, JWKS cache, passwords, refresh tokens
│   ├── events/              # Envelopes, publisher/subscriber, idempotent consumers
│   ├── rabbitmq/            # Broker connection
│   └── sharedhttp/          # Error envelopes, auth, request IDs, JSON helpers
├── workers/
│   ├── daily-cron/          # Missed-daily processing and cycle rollover
│   └── expedition-worker/   # Due-expedition resolution
├── docs/
│   ├── adr/                 # Architectural decisions and rationale
│   ├── openapi/             # Service HTTP wire contracts
│   └── specs/               # Product, delivery, and release evidence
├── docker-compose.yml       # Four PostgreSQL instances and RabbitMQ
├── go.work
└── Makefile
```

Important architectural properties:

- Database per service: no service reads another service's database.
- RabbitMQ uses the durable `galaxify.events` topic exchange and versioned
  event envelopes.
- Unroutable messages go to `galaxify.unroutable`; rejected consumer messages
  go to `galaxify.dead_letters`.
- Consumers deduplicate by `event_id` and apply the deduplication record and
  domain mutation in one PostgreSQL transaction.
- HTTP APIs use the standard library `http.ServeMux`, shared error envelopes,
  request IDs, and bearer-token middleware.
- Goose owns migrations and sqlc generates the database layer.

See [`docs/adr/`](docs/adr/) for design rationale and
[`docs/specs/`](docs/specs/) for product and delivery requirements.

## HTTP surface

| Service | Port | Implemented routes |
| --- | ---: | --- |
| User | `8081` | `GET /health`, `POST /users`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /.well-known/jwks.json`, `GET/PATCH/DELETE /users/me` |
| Daily | `8082` | `GET /health`, `POST/GET /dailies`, `GET /dailies/history`, `GET /dailies/difficulties`, `GET/PATCH/DELETE /dailies/{id}`, `POST /dailies/{id}/complete` |
| Ship | `8083` | `GET /health`, `GET /ships/me`, `POST /ships/repair` |
| Expedition | `8084` | `GET /health`, `GET /expeditions`, `GET /expeditions/current`, `GET /expeditions/quote`, `GET /expeditions/{id}`, `POST /expeditions/launch` |

All routes except health, signup, login, refresh, logout, and JWKS require an
access token issued by User Service. The [OpenAPI contracts](docs/openapi/)
are the source of truth for request and response shapes.

## Local development

### Prerequisites

- Go `1.26.0`
- Node.js `^24` and npm `>=11`
- Docker with Docker Compose
- [Goose](https://github.com/pressly/goose) for migrations
- [sqlc](https://sqlc.dev/) only when regenerating query code

### Quick start: the complete local product

`make dev` starts everything in healthy order with a repository-owned
supervisor: Docker infrastructure, idempotent migrations, User Service (waited
on for its `/health`), the remaining services, the workers, then Vite.

```sh
make dev          # real services (default)
```

Open <http://127.0.0.1:5173>. Stop it with `Ctrl-C`, which cleans up the
application processes and preserves Docker volumes and database data. From
another terminal, `make dev-down` does the same and stops infrastructure.

Prefer isolated frontend work with deterministic data? Run the MSW-backed mock
stack, which defaults to the `established-player` scenario and never starts Go
services:

```sh
npm --prefix apps/web-frontend run dev:mock
```

Frontend modes, environment variables, mock scenarios, reset behavior, and
troubleshooting live in
[`apps/web-frontend/README.md`](apps/web-frontend/README.md).

### Canonical local development commands

| Command | Description |
| --- | --- |
| `make dev` | Start infrastructure, migrations, all services, workers, and Vite under one supervisor |
| `make dev-infra` | Start PostgreSQL and RabbitMQ and wait until healthy |
| `make dev-down` | Stop application processes and infrastructure, preserving data |
| `make dev-reset` | Confirmation-gated: delete local volumes, restart infrastructure, and reapply migrations |
| `npm --prefix apps/web-frontend run dev` | Run Vite against already-running real services |
| `npm --prefix apps/web-frontend run dev:mock` | Run Vite with deterministic MSW handlers |

The supervisor prefixes logs by process, redacts credentials and tokens, fails
the stack if any application child exits unexpectedly, and detects occupied
API ports before launch. `node scripts/dev.mjs --no-infra` attaches to
infrastructure that is already healthy (for example, another worktree or CI).

### Manual backend startup (fallback)

From the repository root:

```sh
for dir in apps/{user,daily,ship,expedition}-service workers/{daily-cron,expedition-worker}; do
  cp "$dir/.env.example" "$dir/.env"
done
docker compose up -d
make goose-up
```

Run each process in its own terminal. Start User Service before Daily Service
because Daily warms its JWKS cache from User Service during startup.

```sh
cd apps/user-service && go run .
cd apps/daily-service && go run .
cd apps/ship-service && go run .
cd apps/expedition-service && go run .
cd workers/daily-cron && go run .
cd workers/expedition-worker && go run .
```

The example values match `docker-compose.yml`. Each process loads its local
`.env` and also has matching code defaults. Configuration can override database
URLs, RabbitMQ, HTTP addresses, Daily Service's `JWKS_URL`, and the worker's
`CRON_INTERVAL`.

Check the running APIs:

```sh
curl localhost:8081/health
curl localhost:8082/health
curl localhost:8083/health
curl localhost:8084/health
```

RabbitMQ's management UI is available at <http://localhost:15672> with the
local credentials `guest` / `guest`.

### Troubleshooting

- **`make dev` reports an occupied port**: another stack owns it. Run
  `make dev-down`, or, when infrastructure is already healthy, attach with
  `node scripts/dev.mjs --no-infra`.
- **A service exits during startup**: the supervisor stops every application
  child and exits non-zero; scroll the prefixed logs for the failing process.
- **`make dev-reset` is refused**: it requires an explicit `y`/`yes`; it
  permanently deletes local database volumes before reapplying migrations.
- **Unknown mock scenario**: `npm run dev:mock` fails at startup and lists the
  valid scenario names. See the frontend README.

## Development commands

The root Makefile runs commands in each applicable module. Do not run
`go build ./...` at the repository root: there is no root `go.mod`.

| Command | Description |
| --- | --- |
| `make test` | Run unit tests in every service, worker, and `pkg` |
| `make coverage` | Run coverage tests in every service and worker |
| `make build` | Build service and worker binaries into module-local `bin/` directories |
| `make vet` | Run `go vet ./...` in every service, worker, and `pkg` |
| `make goose-up` | Apply migrations for all four service databases |
| `make goose-down` | Roll back one migration in every service database |
| `make sqlc` | Regenerate database code for all four services |
| `make fmt` | Run `gofmt` over repository Go files |
| `make tidy` | Run `go mod tidy` in every Go module |
| `make frontend-install` | Install frontend dependencies from the committed lockfile |
| `make frontend-verify` | Run the complete frontend formatting, type, lint, test, browser, accessibility, and performance gate |
| `make help` | List available targets |

When changing a module, the required verification is `go build ./...`,
`go test ./...`, and `go vet ./...` from that module's directory. A change to
`pkg` also requires verification in every importing module.

## Backlog

GitHub issues are the source of truth for future scope, dependencies, and
completion criteria. See the
[current open issues](https://github.com/thalesraymond/galaxify-monorepo/issues?q=is%3Aissue%20state%3Aopen).
