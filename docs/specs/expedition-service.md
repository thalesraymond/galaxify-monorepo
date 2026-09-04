\# Expedition Service Specification

This document defines the implementation details for the Expedition Service (Phase 1). It is governed by the [Cross-Cutting Backend Concerns](./cross-cutting.md) for HTTP error envelopes, auth, event outbox, and event consumption.

## Domain Model

- **Expedition**: `{ id (UUID), user_id (UUID), materials_invested (integer), success_chance (float [0..1]), resolve_at (timestamptz), status (IN_FLIGHT | RESOLVED | FAILED), created_at (timestamptz), resolved_at (timestamptz) }`
- **ExpeditionResult**: `{ id (UUID), expedition_id (UUID), outcome (SUCCESS | FAILURE), reward_summary (JSONB), created_at (timestamptz) }`
- **UserShipStateCache**: `{ user_id (UUID, PK), hull_health (integer), materials_balance (integer), updated_at (timestamptz) }`

## Database Schema

Location: `apps/expedition-service/sql/schema/`

Tables:
1. `expeditions`: Stores expedition state.
2. `expedition_results`: Stores the outcome and reward summary for resolved expeditions.
3. `user_ship_state_cache`: Read-only mirror of the user's ship state (hull health and materials balance), updated by `ship.status_updated` events.
4. `outbox` and `processed_events`: Managed per cross-cutting specs.

Required sqlc queries:
- `insert_expedition`: Insert a new expedition.
- `get_by_id`: Retrieve an expedition by ID.
- `get_current_by_user`: Retrieve the user's currently-active expedition (status = 'IN_FLIGHT').
- `list_by_user`: List the user's expeditions (paginated, ordered by created_at DESC).
- `get_last_resolve_at`: Retrieve the `resolve_at` of the user's most recent expedition (for one-per-week enforcement).
- `upsert_ship_cache`: Upsert into `user_ship_state_cache`.
- `get_ship_cache`: Retrieve the user's cached ship state.
- `insert_expedition_result`: Insert an expedition result.

## HTTP API Surface

Auth: Required (Bearer token via cross-cutting middleware).

- `POST /expeditions/launch`
  - Request: `{ "materials_invested": 10 }`
  - Validates: `materials_invested > 0`, `materials_invested <= materials_balance` (from cache).
  - Checks one-per-week rule: rejects if user has an `IN_FLIGHT` expedition OR if the user's last expedition has `resolve_at < now() - 7 days`.
  - Computes success chance: `(materials_invested / (materials_invested + 10)) * (hull_health / 100)`.
  - Computes resolve time: `resolve_at = now() + 7 days + random_jitter` (jitter: ±12 hours).
  - Inserts expedition with status `IN_FLIGHT`.
  - Publishes `expedition.launched` event to `galaxify.events` (via outbox).
  - Returns 201 with the expedition details.
  - Errors: `EXPEDITION_ALREADY_ACTIVE` (409), `EXPEDITION_COOLDOWN` (422), `EXPEDITION_INSUFFICIENT_MATERIALS` (422), `VALIDATION_FAILED` (422).

- `GET /expeditions/current`
  - Returns the user's currently-active expedition (if any).
  - Returns 404 `EXPEDITION_NOT_FOUND` if no active expedition.

- `GET /expeditions/{id}`
  - Returns a single expedition + result (when resolved).
  - Returns 404 `EXPEDITION_NOT_FOUND` if not found.

- `GET /expeditions`
  - Returns the user's expedition history (paginated, ordered by created_at DESC).
  - Query params: `limit` (default 20, max 100), `offset` (default 0).

## Event Consumption

All consumers use `processed_events` for idempotency on `event_id` (the UUID from the event envelope, per cross-cutting spec §1).

- **`ship.status_updated`**:
  - Subscribes to `ship.status_updated` events on `galaxify.events`.
  - Action: Upserts into `user_ship_state_cache` with the new hull health and materials balance.
  - Idempotent on `event_id`.

- **`user.created`**:
  - Subscribes to `user.created` events on `galaxify.events`.
  - Action: Seeds `user_ship_state_cache` with `hull_health = 100, materials_balance = 0`.
  - Idempotent on `event_id`.

## Event Publication

Events published via the outbox pattern to the `galaxify.events` exchange.

- **`expedition.launched`**:
  - Published by `POST /expeditions/launch` after inserting the expedition row.
  - Payload: `{ "version": 1, "user_id": "...", "expedition_id": "...", "materials_invested": 10, "success_chance": 0.5, "resolve_at": "2026-09-09T12:00:00Z" }`
  - Consumers: Ship Service (deducts materials from `ships` table).

- **`expedition.completed`**:
  - Published by the expedition worker after resolving the expedition.
  - Payload: `{ "version": 1, "user_id": "...", "expedition_id": "...", "outcome": "SUCCESS", "materials_reward": 20 }`
  - Consumers: Ship Service (adds materials reward to `ships` table if success).

## Async Worker

Location: `workers/expedition-worker/`

Cron-style worker that polls the DB periodically (every 5 minutes) for `IN_FLIGHT` expeditions where `resolve_at < now()`.

Worker flow:
1. Query: `SELECT * FROM expeditions WHERE status = 'IN_FLIGHT' AND resolve_at < now() LIMIT 100`.
2. For each expedition:
   a. Roll the dice: `success = random() < success_chance`.
   b. Compute reward: if success, `materials_reward = materials_invested * (2.0 + random(-0.5, +0.5))` (uniform float in [1.5, 2.5], average 2.0x). If failure, `materials_reward = 0`.
   c. Update expedition status: `UPDATE expeditions SET status = 'RESOLVED' | 'FAILED', resolved_at = now() WHERE id = $1`.
   d. Insert expedition result: `INSERT INTO expedition_results (expedition_id, outcome, reward_summary)`.
   e. Publish `expedition.completed` event to `galaxify.events`.
3. On startup, scan for all `IN_FLIGHT` expeditions whose `resolve_at < now()` and process them (robust to restarts).

## Success Formula

`success_chance = (materials_invested / (materials_invested + 10)) * (hull_health / 100)`

- The rational function `x / (x + 10)` gives a "half-max" point at 10 materials invested (50% base chance at full hull).
- No hard cap on `materials_invested`, but the curve naturally discourages over-investment:
  - 1 material → 9% base chance
  - 10 materials → 50% base chance
  - 50 materials → 83% base chance
  - 100 materials → 91% base chance
- Hull health acts as a multiplier: a damaged ship at 50% hull halves your success chance regardless of investment.

## Reward Formula

`materials_reward = materials_invested * (2.0 + random(-0.5, +0.5))`

- Uniform float multiplier in [1.5, 2.5], average 2.0x.
- On failure: `materials_reward = 0`.
- The `reward_summary` JSON: `{ "materials_reward": 20 }`.

## One-Per-Week Enforcement

- Check if the user has an `IN_FLIGHT` expedition. If yes, reject with `EXPEDITION_ALREADY_ACTIVE`.
- Check if the user's last expedition (resolved or failed) has `resolve_at < now() - 7 days`. If yes, allow. Otherwise, reject with `EXPEDITION_COOLDOWN`.

This is future-proof: if we introduce variable duration or cancellation, the one-per-week rule still works.

## Error Codes

| Code                              | HTTP Status | When                                                |
|-----------------------------------|-------------|-----------------------------------------------------|
| `VALIDATION_FAILED`               | 422         | Invalid input (see `details.field_errors`)          |
| `EXPEDITION_NOT_FOUND`            | 404         | Expedition not found                                |
| `EXPEDITION_ALREADY_ACTIVE`       | 409         | User has an `IN_FLIGHT` expedition                  |
| `EXPEDITION_COOLDOWN`             | 422         | User's last expedition resolved within 7 days       |
| `EXPEDITION_INSUFFICIENT_MATERIALS` | 422       | `materials_invested > materials_balance` (cache)    |
| `INTERNAL_ERROR`                  | 500         | Unexpected server error                             |

## Out of Scope (Phase 1)

- Cooperative multiplayer expeditions.
- Raid-style boss expeditions (Phase 4).
- Expedition chains.
- Dynamic difficulty scaling.
- Variable expedition duration.
- Expedition cancellation.
- Procedural reward tables (beyond materials).
