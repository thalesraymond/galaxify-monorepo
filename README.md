# Galaxify

Galaxify is a space-themed daily-task game built for the Boot.dev backend
track. Players complete recurring dailies to earn ship materials, miss dailies
and take hull damage, repair their ship, and eventually invest materials in
weekly expeditions.

The backend is a Go workspace monorepo of independently deployable services.
Each service owns a PostgreSQL database and communicates through a RabbitMQ
topic exchange. The frontend is still a placeholder.

## Project status

Galaxify is under active development. Authentication and the recurring-daily
lifecycle are implemented; the Ship Service is partially implemented; the
Expedition Service is still at infrastructure-scaffold stage.

| Component | Current implementation |
| --- | --- |
| User Service | Signup, login, refresh-token rotation and reuse detection, EdDSA access tokens, JWKS, authenticated profile read/update/delete, and `user.created` / `user.deleted` publication |
| Daily Service | Authenticated daily CRUD, completion, history, recurring lifecycle, user-cache consumers, and `daily.completed` publication |
| Daily Cron | Five-minute missed/completed sweep, archival history, deadline rollover, and `daily.missed` publication |
| Ship Service | Ship schema and queries plus an idempotent `user.created` consumer that provisions the default ship; only `/health` is exposed over HTTP today |
| Expedition Service | PostgreSQL/RabbitMQ startup wiring and `/health`; expedition domain behavior is not implemented yet |
| Web frontend | Placeholder only; the frontend stack has not been selected |

Event publication currently happens directly after database work. Consumer-side
deduplication is transactional, but producer-side delivery is not yet atomic:
RabbitMQ failures can lose an event after a state change commits. The
[transactional outbox ticket](https://github.com/thalesraymond/galaxify-monorepo/issues/20)
is the main cross-cutting reliability gap.

## Architecture

The committed [`go.work`](go.work) joins six Go modules:

```text
.
├── apps/
│   ├── user-service/        # Accounts, sessions, signing keys, JWKS
│   ├── daily-service/       # Recurring dailies and history
│   ├── ship-service/        # Hull and materials (partially implemented)
│   ├── expedition-service/  # Weekly expeditions (scaffold)
│   └── web-frontend/        # Placeholder; not a Go module
├── pkg/
│   ├── auth/                # EdDSA JWT, JWKS cache, passwords, refresh tokens
│   ├── events/              # Envelopes, publisher/subscriber, idempotent consumers
│   ├── rabbitmq/            # Broker connection
│   └── sharedhttp/          # Error envelopes, auth, request IDs, JSON helpers
├── workers/
│   └── daily-cron/          # Missed-daily processing and cycle rollover
├── docs/
│   ├── adr/                 # Architectural decisions and rationale
│   └── specs/               # Phase 1 target behavior
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
[`docs/specs/`](docs/specs/) for the Phase 1 target contracts. Specs describe
the intended end state; the status table above identifies what exists today.

## HTTP surface

| Service | Port | Implemented routes |
| --- | ---: | --- |
| User | `8081` | `GET /health`, `POST /users`, `POST /auth/login`, `POST /auth/refresh`, `GET /.well-known/jwks.json`, `GET/PATCH/DELETE /users/me` |
| Daily | `8082` | `GET /health`, `POST/GET /dailies`, `GET /dailies/history`, `GET/PATCH/DELETE /dailies/{id}`, `POST /dailies/{id}/complete` |
| Ship | `8083` | `GET /health` |
| Expedition | `8084` | `GET /health` |

All non-health Daily routes and the `/users/me` routes require an access token
issued by User Service.

## Local development

### Prerequisites

- Go `1.25.7`
- Docker with Docker Compose
- [Goose](https://github.com/pressly/goose) for migrations
- [sqlc](https://sqlc.dev/) only when regenerating query code

### Start the backend

From the repository root:

```sh
for dir in apps/{user,daily,ship,expedition}-service workers/daily-cron; do
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
| `make help` | List available targets |

When changing a module, the required verification is `go build ./...`,
`go test ./...`, and `go vet ./...` from that module's directory. A change to
`pkg` also requires verification in every importing module.

## Current implementation tickets

The open backlog as of 2026-09-11 is organized around these milestones:

1. **Reliable event publication** — the transactional outbox and bounded
   HTTP-triggered drain
   ([#20](https://github.com/thalesraymond/galaxify-monorepo/issues/20)) are
   implemented across User, Daily, Ship, and Expedition, plus the
   `daily-cron` worker (staging events in the mutation transaction and draining
   through `pkg/events.OutboxDrainer`).
2. **Finish Ship Service** — consume daily outcomes
   ([#64](https://github.com/thalesraymond/galaxify-monorepo/issues/64)), add
   repair ([#65](https://github.com/thalesraymond/galaxify-monorepo/issues/65))
   and ship reads
   ([#67](https://github.com/thalesraymond/galaxify-monorepo/issues/67)), then
   cover the complete flow with integration tests
   ([#66](https://github.com/thalesraymond/galaxify-monorepo/issues/66)).
3. **Build Expedition Service** — add the schema and queries
   ([#74](https://github.com/thalesraymond/galaxify-monorepo/issues/74)), cache
   consumers
   ([#69](https://github.com/thalesraymond/galaxify-monorepo/issues/69),
   [#73](https://github.com/thalesraymond/galaxify-monorepo/issues/73)), launch
   and read APIs
   ([#70](https://github.com/thalesraymond/galaxify-monorepo/issues/70),
   [#77](https://github.com/thalesraymond/galaxify-monorepo/issues/77)), and the
   resolution worker
   ([#75](https://github.com/thalesraymond/galaxify-monorepo/issues/75)).
4. **Connect expeditions to ships** — deduct invested materials
   ([#71](https://github.com/thalesraymond/galaxify-monorepo/issues/71)) and
   grant successful rewards
   ([#72](https://github.com/thalesraymond/galaxify-monorepo/issues/72)).
5. **Complete integration coverage** — User
   ([#53](https://github.com/thalesraymond/galaxify-monorepo/issues/53)), Daily
   ([#60](https://github.com/thalesraymond/galaxify-monorepo/issues/60)), and
   Expedition
   ([#76](https://github.com/thalesraymond/galaxify-monorepo/issues/76)).

GitHub issues are the source of truth for scope, dependencies, and completion
criteria. See the
[current open issues](https://github.com/thalesraymond/galaxify-monorepo/issues?q=is%3Aissue%20state%3Aopen)
for changes after the date above.
