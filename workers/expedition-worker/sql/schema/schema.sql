-- Minimal schema stubs for sqlc code generation.
-- The authoritative migration files live in apps/expedition-service/sql/schema/.
-- Only the tables used by the expedition worker are included here.

CREATE TABLE expeditions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL,
    materials_invested INTEGER NOT NULL CHECK (materials_invested > 0),
    success_chance     DOUBLE PRECISION NOT NULL CHECK (success_chance BETWEEN 0 AND 1),
    resolve_at         TIMESTAMPTZ NOT NULL,
    status             TEXT NOT NULL DEFAULT 'IN_FLIGHT'
                       CHECK (status IN ('IN_FLIGHT', 'RESOLVED', 'FAILED')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at        TIMESTAMPTZ
);

CREATE TABLE expedition_results (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expedition_id  UUID NOT NULL REFERENCES expeditions(id) ON DELETE CASCADE,
    outcome        TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE')),
    reward_summary JSONB NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mirrors apps/expedition-service/sql/schema/003_expedition_domain.sql and
-- 004_outbox_request_id.sql. Staged here only so sqlc can generate the outbox
-- queries the expedition worker needs.
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
