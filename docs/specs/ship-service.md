# Ship Service Specification

This document defines the implementation details for the Ship Service (Phase 1). It is governed by the [Cross-Cutting Backend Concerns](./cross-cutting.md) for HTTP error envelopes, auth, event outbox, and event consumption.

## Domain Model

- **Ship**: `{ user_id (PK, UUID), hull_health (integer [0..100], default 100), materials_balance (integer, default 0), level (integer, default 1), updated_at (timestamptz) }`
  - 1 row per user.
  - For Phase 1, `level` remains statically at 1 (upgrades are out of scope).

## Database Schema

Location: `apps/ship-service/sql/schema/`

Tables:
1. `ships`: Stores ship state for users.
2. `outbox` and `processed_events`: Managed per cross-cutting specs (outbox schema lives in `pkg/events` per #20; `processed_events` is per-service).

Required sqlc queries:
- `get_by_user`: Retrieve a ship by user ID.
- `add_materials`: Atomic update to add materials (`materials_balance = materials_balance + ?`).
- `apply_damage`: Atomic update to reduce hull health (`GREATEST(0, hull_health - ?)`).
- `repair`: Atomic update to deduct materials and restore hull. Takes `user_id`, `materials_to_deduct`, and `hull_to_restore` as parameters (calculated by Go, not SQL).

## HTTP API Surface

Auth: Required (Bearer token via cross-cutting middleware).

- `GET /ships/me`
  - Returns the authenticated user's ship state.
  - Returns 404 `SHIP_NOT_FOUND` if the ship row doesn't exist yet (race with `user.created` event consumption).
- `POST /ships/repair`
  - Parameter-less endpoint (empty body).
  - Go calculates the repair: `deficit = 100 - hull_health`, `materials_to_use = min(deficit, materials_balance)`.
  - Repair formula: 1 material restores `5 + rng(-2, +3)` hull points (uniform integer in [3, 8]), rolled **per material**. Total hull restored = sum of all rolls.
  - The SQL `repair` query receives `user_id`, `materials_to_deduct` (= materials_to_use), and `hull_to_restore` (= sum of rolls, clamped so hull doesn't exceed 100).
  - Rejects with `SHIP_INSUFFICIENT_MATERIALS` (422) if balance is 0 and hull is not full.
  - Rejects with `SHIP_HULL_FULL` (422) if hull is already at 100.
  - Restores hull and deducts materials atomically.
  - Publishes `ship.status_updated` via outbox in the same transaction.

## Event Consumption

All consumers use `processed_events` for idempotency on `event_id` (the UUID from the event envelope, per cross-cutting spec §1).

All consumers publish `ship.status_updated` via the outbox **after** state changes, in the same database transaction.

- **`user.created`**:
  - Subscribes to `user.created` events on `galaxify.events`.
  - Action: Inserts a `ships` row (`level: 1`, `hull_health: 100`, `materials_balance: 0`).
  - Idempotent on `event_id` (using `processed_events`).
  - Does NOT publish `ship.status_updated` (initial state, no downstream consumers need it).
- **`daily.completed`**:
  - Subscribes to `daily.completed` events on `galaxify.events`.
  - Action: Atomic `add_materials(reward_materials)`.
  - Idempotent on `event_id` (using `processed_events`).
  - Publishes `ship.status_updated` with the new materials balance.
- **`daily.missed`**:
  - Subscribes to `daily.missed` events on `galaxify.events`.
  - Action: Atomic `apply_damage(damage_amount)`.
  - Idempotent on `event_id` (using `processed_events`).
  - Publishes `ship.status_updated` with the new hull health.

## Event Publication

Events published via the outbox pattern to the `galaxify.events` exchange, using `pkg/events.Publisher`.

- **`ship.status_updated`**:
  - Published whenever hull or materials change (post-write, in the same transaction).
  - Payload: `{ "version": 1, "user_id": "...", "hull_health": ..., "materials_balance": ... }`

## Out of Scope (Phase 1)

- Ship upgrades/leveling logic (field exists in DB but is static)
- Multiple ships per user
- Equipment slots, fuel, customization, ship naming
