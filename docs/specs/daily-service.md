# Daily Service Specification

This document defines the implementation details for the Daily Service (Phase 1). It is governed by the [Cross-Cutting Backend Concerns](./cross-cutting.md) for HTTP error envelopes, auth, event outbox, and event consumption.

## Domain Model

- **Daily**: `{ id, user_id, title, description, difficulty [EASY|MEDIUM|HARD], due_date, status [PENDING|COMPLETED|MISSED], created_at, updated_at }`
- **DailyHistory**: Archival table for dailies.
- **Difficulty Mapping**: Difficulty maps to `reward_materials` and `damage_amount` via a static table/configuration (`difficulty_rewards`).

## Database Schema

Location: `apps/daily-service/sql/schema/`

Tables:
1. `users_cache`: Mirror of `user.created` payloads, primary key `user_id`.
2. `dailies`: Holds active dailies.
3. `daily_history`: Archival table for completed or missed dailies.
4. `difficulty_rewards`: Mapping table for difficulties to rewards/damage.
5. `outbox` and `processed_events`: Managed per cross-cutting specs.

Required sqlc queries:
- Create, List, Get, Update, Delete for `dailies`.
- Mark complete: atomic update `PENDING` -> `COMPLETED`.
- Mark miss: atomic update `PENDING` -> `MISSED`.

## HTTP API Surface

Auth: Required (Bearer token via cross-cutting middleware).

- `POST /dailies` — create
- `GET /dailies` — list (filter by date / status)
- `GET /dailies/{id}` — get one
- `PATCH /dailies/{id}` — edit (only if status PENDING)
- `DELETE /dailies/{id}` — delete (only if status PENDING)
- `POST /dailies/{id}/complete` — marks COMPLETED, publishes `daily.completed` exactly once (via outbox)

Errors return standard cross-cutting envelope format (e.g., codes like `DAILY_NOT_FOUND`, `DAILY_NOT_EDITABLE`, `DAILY_ALREADY_COMPLETED`).

## Event Publication

Events published via the outbox pattern to the `galaxify.events` exchange.

- `daily.completed`:
  - Payload: `{ "version": 1, "user_id": "...", "daily_id": "...", "difficulty": "...", "reward_materials": ... }`
- `daily.missed`:
  - Payload: `{ "version": 1, "user_id": "...", "daily_id": "...", "damage_amount": ... }`

## Event Consumption

- **`user.created` consumer**: Subscribes to `user.created` events on `galaxify.events`. Upserts into `users_cache` for local user validation. Uses `processed_events` table for idempotency as defined in cross-cutting spec.

## Cron Worker (Missed Dailies)

Finds expired `PENDING` dailies and marks them `MISSED`. Runs as a standalone
worker in `workers/daily-cron`, completely separate from the stateless
`apps/daily-service` API container, so the API can scale to zero independently.

- **Interval**: Continuous sweep every 5 minutes.
- **Timezone Model**: Evaluates `due_date` against server UTC `now()`.
- **Batch Size**: Processes in batches of 500 using `LIMIT` and `FOR UPDATE SKIP LOCKED` to prevent lock contention and enable safe concurrent execution.
- **Idempotency**: Marks `status = 'PENDING' AND due_date < now()` → `MISSED` inside a single transaction per batch. The status check prevents double-marking.

### ⚠️ Event publication deferred to [#20](https://github.com/thalesraymond/galaxify-monorepo/issues/20)

`daily.missed` events are **not yet published**. The outbox table, outbox drain
logic, and RabbitMQ wiring are all part of issue #20 (transactional outbox
pattern). Once #20 lands, the worker will write a `daily.missed` row to the
`outbox` table **inside the same transaction** as the `MISSED` status update,
guaranteeing atomicity between state change and event.

## Out of Scope (Phase 1)
- Recurring daily templates.
- Snooze functionality.
- Partial-completion rules.
- Streaks/achievements.
- Push notifications.
- Timezone-aware UI.
