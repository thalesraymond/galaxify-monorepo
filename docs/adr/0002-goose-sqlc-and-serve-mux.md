# ADR-0002: Goose and sqlc for database tooling, stdlib ServeMux for HTTP APIs

- **Status:** Accepted
- **Date:** 2026-08-29
- **Source:** project planning notes (Boot.dev final project, Galaxify)

## Context

Each Galaxify Go service owns an isolated PostgreSQL database and exposes an
HTTP API consumed by the web frontend (and later by other services). Two
recurring needs follow from ADR-0001:

1. **Database migrations** — every schema change must be reviewable, versioned,
   and applied idempotently against each service's dedicated Postgres instance.
2. **Type-safe query code** — hand-writing structs and scanners for every query
   is error-prone and does not survive schema drift. We want queries written in
   SQL (the language Postgres understands best), checked against the schema, and
   turned into Go code at build time.
3. **HTTP routing** — the services now behave as long-running web servers and
   need a small, predictable HTTP surface. Galaxify is a learning project
   (Boot.dev backend track), so a key constraint is that the HTTP layer stays
   close enough to the standard library that core concepts remain visible.

## Decision

- **Migrate with [goose](https://github.com/pressly/goose).** Migrations are
  plain, versioned SQL files in `apps/<service>/sql/schema/` (e.g.
  `001_test_table.sql`) with `-- +goose Up` / `-- +goose Down` annotations.
  Each service has a `goose.sh` wrapper that sources `.env` and drives
  `goose up|down` against the configured `GOOSE_DBSTRING`.
- **Generate query code with [sqlc](https://sqlc.dev).** SQL queries live in
  `apps/<service>/sql/queries/`; `sqlc generate` (per `sqlc.yaml`, pgx/v5
  package, `emit_interface: true`) produces the `internal/database` package —
  structs, query functions, and the `Querier` interface. Query correctness is
  enforced at compile time against the migration schema.
- **Route HTTP requests with the native Go `net/http` `ServeMux`.** Each
  service builds its handler on `http.NewServeMux()` using Go 1.22+ method
  patterns (e.g. `GET /health`), served by an `http.Server` started from
  `main`. No third-party web framework.

## Alternatives Considered

### Migrations

#### golang-migrate/migrate
- Pros: Popular, file-based migrations, embeds cleanly.
- Cons: Heavier CLI; goose's embedded SQL-file workflow was simpler to line up
  with our per-service `.env` layout.
- Rejected: goose keeps migrations as plain SQL with an explicit up/down
  split and has a smaller learning surface, which fits the project's scope.

#### Raw `psql` script / manual migration log
- Pros: Zero tooling.
- Cons: No version tracking, no rollback story, easy to drift between services.
- Rejected: versioned migrations are table stakes for schema reviews.

#### ORM `AutoMigrate` (GORM)
- Pros: Schema evolves from Go structs, least SQL.
- Cons: Hides the generated DDL, surprising production diffs, no explicit
  migration files to review.
- Rejected: we want reviewable, explicit schema history, not implicit DDL.

### Query code generation

#### No sqlc — `database/sql` or `pgx` by hand
- Pros: No extra tool, full control.
- Cons: Boilerplate structs/scanners per query, no schema-staleness checks,
  drift between query and models is silent.
- Rejected: sqlc catches stale queries at `generate`/build time.

#### ORM (GORM / sqlx)
- Pros: Convenient, familiar.
- Cons: Runtime reflection or weak typing, generated SQL is harder to review,
  overkill for a microservice surface that is mostly CRUD over simple tables.
- Rejected: sqlc keeps SQL explicit, types compile-time checked, and generated
  packages are plain Go with no framework.

### HTTP framework

#### chi / gin / echo
- Pros: Middleware ecosystem, batteries included, familiar patterns.
- Cons: Third-party dependency for a surface currently of one endpoint;
  hides `net/http` fundamentals (exactly what the project wants to exercise);
  framework lock-in before any real API exists.
- Rejected: premature; stdlib ServeMux gives method+path routing for free
  since Go 1.22 and keeps the HTTP layer transparent.

## Consequences

- Schema history is reviewable plain SQL under each service's `sql/schema/`,
  applied with `env GOOSE_* ./goose.sh up|down`.
- Queries are written in SQL, code-generated into `internal/database`, and
  kept honest by sqlc's schema checks — no hand-written models or scanners.
- Every service is now a long-running web server: `main` connects to
  PostgreSQL and RabbitMQ, then serves `GET /health` (and future routes)
  on an `http.Server` until it receives SIGINT/SIGTERM, then shuts down
  gracefully.
- The HTTP layer carries zero third-party dependencies; moving to a framework
  later is a contained change (swap the handler construction in one spot per
  service) and would warrant a new ADR.
- Tooling footprint per service: `sqlc.yaml`, `goose.sh`,
  `goose` + `sqlc` CLI.