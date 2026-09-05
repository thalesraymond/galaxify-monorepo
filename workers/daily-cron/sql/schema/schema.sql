-- Minimal schema stubs for sqlc code generation.
-- The authoritative migration files live in apps/daily-service/sql/schema/.
-- Only the tables used by the daily-cron worker are included here.

CREATE TABLE difficulty_rewards (
    difficulty       TEXT PRIMARY KEY,
    reward_materials INT  NOT NULL,
    damage_amount    INT  NOT NULL
);

CREATE TABLE users_cache (
    id UUID PRIMARY KEY
);

CREATE TABLE dailies (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users_cache(id) ON DELETE CASCADE,
    title       TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    difficulty  TEXT        NOT NULL REFERENCES difficulty_rewards(difficulty),
    due_date    TIMESTAMPTZ NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'PENDING',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
