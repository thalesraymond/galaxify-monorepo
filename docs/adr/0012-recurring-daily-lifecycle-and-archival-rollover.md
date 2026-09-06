# ADR-0012: Recurring Daily Lifecycle and Archival Rollover

- **Status:** Accepted
- **Date:** 2026-09-06
- **Source:** Domain Analysis & Grilling Session (Addressing Daily Completion Gap)

## Context

In Habitica and core habit-tracking mechanics, "Dailies" are persistent habits that repeat every day. Users mark them complete for rewards; if missed before the deadline, they incur penalties. At the start of a new day, completed and missed tasks uncheck/reset back to `PENDING` so the user can perform them again.

In Galaxify's initial Phase 1 specification, "recurring daily templates" was categorized as out of scope. Consequently:
1. When a task was marked completed via `POST /dailies/{id}/complete`, `dailies.status` was set to `COMPLETED` permanently.
2. When a pending task's deadline passed, `workers/daily-cron` set `dailies.status` to `MISSED` permanently.
3. No reset or rollover mechanism existed, rendering dailies single-use To-Dos rather than daily recurring habits.
4. The schema table `daily_history` and its query `CreateDailyHistory` were provisioned but completely unused because tasks never archived or rolled over.

## Decision

We establish that **all daily tasks are recurrent by design**. The system adopts a two-table lifecycle dividing current-cycle state from historical audit execution:

### 1. Active Cycle vs. Archival History
- **`dailies`**: Represents the current 24-hour cycle. A daily task row persists indefinitely until explicitly deleted by the user. Its status is strictly binary in practice:
  - `PENDING`: Waiting to be completed in the active cycle.
  - `COMPLETED`: Completed in the active cycle (locked against re-completion farming).
- **`daily_history`**: An append-only audit log recording the terminal outcome of each cycle (`COMPLETED` or `MISSED`) with timestamp snapshots (`completed_at`, `missed_at`, `due_date`, `archived_at`).

### 2. Immediate History Logging on Completion
When `POST /dailies/{id}/complete` executes:
- In the same transaction as updating `dailies.status = 'COMPLETED'`, an entry is inserted into `daily_history` (`status = 'COMPLETED'`, `completed_at = now()`).
- The task in `dailies` remains `COMPLETED` until its `due_date` passes, preventing double-completion.
- The `daily.completed` domain event is published.

### 3. Worker-Driven Daily Rollover (`workers/daily-cron`)
The background worker in `workers/daily-cron` sweeps every 5 minutes and runs a two-phase batch rollover:
1. **Missed Pending Sweep (`status = 'PENDING' AND due_date < now()`)**:
   - Inserts a record into `daily_history` (`status = 'MISSED'`, `missed_at = now()`).
   - Publishes `daily.missed` (staged in outbox per ADR-0004 once #20 lands).
   - Resets active task in `dailies`: keeps `status = 'PENDING'` and snaps `due_date` forward to the next cycle preserving time-of-day.
2. **Completed Reset Sweep (`status = 'COMPLETED' AND due_date < now()`)**:
   - Resets active task in `dailies`: sets `status = 'PENDING'` and advances `due_date = due_date + INTERVAL '1 day'`.
   - Emits no events and writes no history (already written on completion).

### 4. Resilient Deadline Snapping for Inactive Users
If a user is inactive for multiple days, the worker applies a **single miss penalty** for the expired period and advances `due_date` forward in 24-hour increments until `due_date > now()`:
```sql
due_date = due_date + CEIL(EXTRACT(EPOCH FROM (now() - due_date)) / 86400) * INTERVAL '1 day'
```
This prevents damage cascading / death spirals for inactive players and prevents queue floods.

### 5. API Surface Adjustments
- `GET /dailies`: Returns active tasks for the current cycle.
- `GET /dailies/history`: Dedicated endpoint to list historical task executions from `daily_history` ordered by `due_date DESC`.
- `PATCH /dailies/{id}`: Permits editing `title`, `description`, `difficulty` even if today's status is `COMPLETED`.
- `DELETE /dailies/{id}`: Deletes the recurring task from `dailies` even if `COMPLETED` today, leaving past logs in `daily_history` intact.

## Consequences

- **Domain Integrity**: Galaxify faithfully mirrors Habitica's core daily habit loop.
- **Data Cleanness**: `dailies` remains a compact table containing only active tasks per user.
- **Historical Visibility**: Users and downstream services (e.g. streaks, analytics) have a rich, queryable `daily_history` log.
- **Worker Simplicity**: `workers/daily-cron` operates via two non-blocking batch steps (`FOR UPDATE SKIP LOCKED`).
