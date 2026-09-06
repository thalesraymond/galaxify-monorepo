# Daily Service Specification

This document defines the implementation details for the Daily Service (Phase 1). It is governed by the [Cross-Cutting Backend Concerns](./cross-cutting.md) for HTTP error envelopes, auth, event outbox, and event consumption.

## Domain Model

- **Daily**: `{ id, user_id, title, description, difficulty [EASY|MEDIUM|HARD], due_date, status [PENDING|COMPLETED], created_at, updated_at }`. All dailies are recurrent by design; active tasks in `dailies` represent the current 24-hour cycle.
- **DailyHistory**: `{ id, daily_id, user_id, title, description, difficulty, due_date, status [COMPLETED|MISSED], completed_at, missed_at, archived_at }`. Archival log capturing the outcome of each completed or missed daily cycle.
- **Difficulty Mapping**: Difficulty maps to `reward_materials` and `damage_amount` via a static table/configuration (`difficulty_rewards`).

## Database Schema

Location: `apps/daily-service/sql/schema/`

Tables:
1. `users_cache`: Mirror of `user.created` payloads, primary key `user_id`.
2. `dailies`: Holds active tasks for the current daily cycle. The `status` is either `PENDING` (due today) or `COMPLETED` (finished for today).
3. `daily_history`: Archival log table for historical completions and misses.
4. `difficulty_rewards`: Mapping table for difficulties to rewards/damage.
5. `outbox` and `processed_events`: Managed per cross-cutting specs.

Required sqlc queries:
- Create, List, Get, Update, Delete for `dailies`.
- List history from `daily_history` for user.
- Complete daily: atomic transition `PENDING` -> `COMPLETED`, insert into `daily_history` (`status = 'COMPLETED'`).
- Worker queries:
  - Select expired pending dailies (`status = 'PENDING' AND due_date < now()`) with `FOR UPDATE SKIP LOCKED`.
  - Atomically log to `daily_history` (`status = 'MISSED'`) and reset active `dailies` (`status = 'PENDING'`, snap `due_date` forward).
  - Select expired completed dailies (`status = 'COMPLETED' AND due_date < now()`) with `FOR UPDATE SKIP LOCKED`.
  - Atomically reset active `dailies` (`status = 'PENDING'`, advance `due_date = due_date + INTERVAL '1 day'`).

## HTTP API Surface

Auth: Required (Bearer token via cross-cutting middleware).

- `POST /dailies` — create a new recurring daily task
- `GET /dailies` — list active dailies for the current cycle (filter by date / status)
- `GET /dailies/history` — list past execution history from `daily_history` (ordered by `due_date DESC`)
- `GET /dailies/{id}` — get one active daily
- `PATCH /dailies/{id}` — edit active daily (title, description, difficulty; permitted even if COMPLETED today)
- `DELETE /dailies/{id}` — delete active recurring daily (permitted even if COMPLETED today; preserves past `daily_history`)
- `POST /dailies/{id}/complete` — marks COMPLETED for today, inserts into `daily_history`, publishes `daily.completed` exactly once (via outbox)

Errors return standard cross-cutting envelope format (e.g., codes like `DAILY_NOT_FOUND`, `DAILY_ALREADY_COMPLETED`).

## Event Publication

Events published via the outbox pattern to the `galaxify.events` exchange.

- `daily.completed`:
  - Payload: `{ "version": 1, "user_id": "...", "daily_id": "...", "difficulty": "...", "reward_materials": ... }`
- `daily.missed`:
  - Payload: `{ "version": 1, "user_id": "...", "daily_id": "...", "damage_amount": ... }`

## Event Consumption

- **`user.created` consumer**: Subscribes to `user.created` events on `galaxify.events`. Upserts into `users_cache` for local user validation. Uses `processed_events` table for idempotency as defined in cross-cutting spec.

## Cron Worker (Daily Rollover & Missed Dailies)

Runs in `workers/daily-cron` as a standalone worker. Responsible for rolling active dailies over into the next cycle and penalizing missed dailies.

- **Interval**: Continuous sweep every 5 minutes.
- **Timezone Model**: Evaluates `due_date` against server UTC `now()`.
- **Batch Size**: Processes in batches of 500 using `LIMIT` and `FOR UPDATE SKIP LOCKED`.
- **Two-Phase Sweep**:
  1. **Missed Pending Sweep**:
     - Finds `status = 'PENDING' AND due_date < now()`.
     - Atomically inserts a `MISSED` record into `daily_history` (`missed_at = now()`).
     - Snaps `due_date` forward by adding full 24-hour increments until `due_date > now()`, preserving the user's deadline time-of-day.
     - Leaves `status = 'PENDING'` for the new cycle.
     - Publishes `daily.missed` (or stages to outbox per #20).
  2. **Completed Reset Sweep**:
     - Finds `status = 'COMPLETED' AND due_date < now()`.
     - Advances `due_date = due_date + INTERVAL '1 day'` and resets `status = 'PENDING'` for the new cycle.
     - Does not emit events or write to history (history was already written on completion).

### ⚠️ Event publication deferred to [#20](https://github.com/thalesraymond/galaxify-monorepo/issues/20)

`daily.missed` events are **not yet published**. The outbox table, outbox drain
logic, and RabbitMQ wiring are all part of issue #20 (transactional outbox
pattern). Once #20 lands, the worker will write a `daily.missed` row to the
`outbox` table **inside the same transaction** as the miss processing,
guaranteeing atomicity between state change and event.

## Out of Scope (Phase 1)
- Custom recurring schedules (e.g., specific days of week like Monday/Wednesday/Friday). All dailies repeat daily.
- Snooze functionality.
- Partial-completion rules.
- Streaks/achievements.
- Push notifications.
- Timezone-aware UI.
