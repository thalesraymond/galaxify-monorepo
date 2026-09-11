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

CREATE TABLE daily_history (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    daily_id    UUID        NOT NULL,
    user_id     UUID        NOT NULL,
    title       TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    difficulty  TEXT        NOT NULL,
    due_date    TIMESTAMPTZ NOT NULL,
    status      TEXT        NOT NULL,
    completed_at TIMESTAMPTZ,
    missed_at   TIMESTAMPTZ,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mirrors apps/daily-service/sql/schema/004_outbox.sql. Staged here only so
-- sqlc can generate the outbox queries the daily-cron worker needs.
CREATE TABLE outbox (
    id           BIGSERIAL PRIMARY KEY,
    event_id     UUID NOT NULL UNIQUE,
    event_type   TEXT NOT NULL,
    payload      JSONB NOT NULL,
    request_id   TEXT,
    status       TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING', 'PUBLISHED')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
);


