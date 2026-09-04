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

Finds expired `PENDING` dailies and marks them `MISSED`. 
*Note: This runs as a standalone serverless function/worker in `workers/daily-cron`, completely separate from the stateless `apps/daily-service` API container, allowing the API to scale to zero independently. (Note: The `workers/daily-cron` module is pending implementation).*

- **Interval**: Continuous sweep every 5 minutes.
- **Timezone Model**: Evaluates `due_date` against server UTC `now()`.
- **Batch Size**: Processes in batches of 100 or 500 using `LIMIT` and `FOR UPDATE SKIP LOCKED` to prevent lock contention and enable safe concurrent execution.
- **Idempotency / Double-Firing Prevention**: Finds `status = 'PENDING' AND due_date < now()`, updates status to `MISSED`, and inserts a `daily.missed` event into the outbox all within the same database transaction. The status update inherently prevents double processing.

## Out of Scope (Phase 1)
- Recurring daily templates.
- Snooze functionality.
- Partial-completion rules.
- Streaks/achievements.
- Push notifications.
- Timezone-aware UI.
