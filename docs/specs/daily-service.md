# Daily Service Specification

This document defines the implementation details for the Daily Service (Phase 1). It is governed by the [Cross-Cutting Backend Concerns](./cross-cutting.md) for HTTP error envelopes, auth, event outbox, and event consumption.

## Domain Model

- **Daily**: `{ id, user_id, title, description, difficulty [EASY|MEDIUM|HARD], due_date, time_zone, status [PENDING|COMPLETED], created_at, updated_at }`. `due_date` is an RFC3339 instant and `time_zone` is an IANA zone retained until explicitly edited. The API accepts a **local deadline** (local due date + local due time) plus `time_zone` and resolves it to `due_date` in the backend; an ambiguous fall-back wall time selects its first occurrence and a nonexistent spring-forward wall time moves to the first valid local instant after it. Responses also expose the derived `due_local_date`/`due_local_time` projection. All dailies are recurrent by design; active tasks in `dailies` represent the current cycle.
- **DailyHistory**: `{ id, daily_id, user_id, title, description, difficulty, due_date, time_zone, status [COMPLETED|MISSED], completed_at, missed_at, archived_at }`. Archival log capturing the outcome and configured zone of each completed or missed daily cycle; the `due_local_date`/`due_local_time` projection is derived from `due_date` + `time_zone`.
- **Time Zone Validation**: `time_zone` must be an explicit IANA name (UTC is allowed). Go's process-dependent `Local` location and bare aliases are rejected so a deployment host's time zone can never change scheduling.
- **Difficulty Mapping**: Difficulty maps to `reward_materials` and `damage_amount` via a static table/configuration (`difficulty_rewards`). This table is the single source of truth for both `GET /dailies/difficulties` and the awarded-material effect returned by completion.
- **Content Limits**: A Daily `title` is at most 120 characters and its `description` at most 1000 characters, enforced in the domain and surfaced as `422 VALIDATION_FAILED` field errors on create and update.
- **Player Provisioning**: A Player's Daily state is provisioned asynchronously by the `user.created` consumer populating `users_cache`. Until that row exists, Daily operations return the retryable `503 DAILY_PLAYER_NOT_READY` so missing provisioning stays distinguishable from absence (`404`), validation (`422`), and internal failure (`500`).

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

- `POST /dailies` — create a new recurring daily task. Accepts a local deadline (`due_local_date` + `due_local_time`) with an explicit IANA `time_zone`, or a legacy RFC3339 `due_date`; supplying both is rejected. `title` is limited to 120 characters and `description` to 1000.
- `GET /dailies` — list active dailies for the current cycle (filter by status and explicit RFC3339 `from`/`to` instants). The legacy `date`/`due_date` query parameters remain supported and are deprecated: they accept a `YYYY-MM-DD` day or an RFC3339 instant and select that UTC calendar day.
- `GET /dailies/history` — list past execution history from `daily_history` (ordered by `due_date DESC`)
- `GET /dailies/difficulties` — list the backend-owned reward and missed-damage metadata for each difficulty tier in canonical EASY, MEDIUM, HARD order, so the frontend never duplicates reward/damage rules.
- `GET /dailies/{id}` — get one active daily
- `PATCH /dailies/{id}` — edit active daily (title, description, difficulty; permitted even if COMPLETED today). The same 120/1000 character limits apply.
- `DELETE /dailies/{id}` — delete active recurring daily (permitted even if COMPLETED today; preserves past `daily_history`)
- `POST /dailies/{id}/complete` — marks COMPLETED for today, inserts into `daily_history`, publishes `daily.completed` exactly once (via outbox), and returns the completed Daily plus its `awarded_materials` typed effect. Repeating the completion returns `409 DAILY_ALREADY_COMPLETED` without awarding materials again.

While the Player's Daily state is unprovisioned, `POST /dailies`, `GET /dailies`, `GET /dailies/history`, `GET /dailies/{id}`, and `POST /dailies/{id}/complete` return `503 DAILY_PLAYER_NOT_READY`.

Errors return standard cross-cutting envelope format (e.g., codes like `DAILY_NOT_FOUND`, `DAILY_ALREADY_COMPLETED`, `DAILY_PLAYER_NOT_READY`).

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
- **Timezone Model**: Evaluates the UTC `due_date` instant against UTC `now()`, then advances recurrence by local calendar day in the persisted IANA `time_zone`. An ambiguous fall-back wall time selects its first occurrence; a nonexistent spring-forward wall time advances to the first valid local instant after it.
- **Batch Size**: Processes in batches of 500 using `LIMIT` and `FOR UPDATE SKIP LOCKED`.
- **Two-Phase Sweep**:
  1. **Missed Pending Sweep**:
     - Finds `status = 'PENDING' AND due_date < now()`.
     - Atomically inserts a `MISSED` record into `daily_history` (`missed_at = now()`).
      - Snaps `due_date` forward by local calendar days until `due_date > now()`, preserving the configured-zone wall-clock deadline.
     - Leaves `status = 'PENDING'` for the new cycle.
     - Stages a `daily.missed` event in the `outbox` table within the same transaction.
  2. **Completed Reset Sweep**:
     - Finds `status = 'COMPLETED' AND due_date < now()`.
      - Advances the due date by one local calendar day and resets `status = 'PENDING'` for the new cycle.
     - Does not emit events or write to history (history was already written on completion).

### Daily.missed publication

The worker writes a `daily.missed` row to the `outbox` table **inside the same
transaction** as the miss processing, guaranteeing atomicity between the state
change and the event. After each non-empty batch it drains the outbox with the
shared `pkg/events.OutboxDrainer` (see cross-cutting §6 and ADR-0004).

## Out of Scope (Phase 1)
- Custom recurring schedules (e.g., specific days of week like Monday/Wednesday/Friday). All dailies repeat daily.
- Snooze functionality.
- Partial-completion rules.
- Streaks/achievements.
- Push notifications.
