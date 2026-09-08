-- +goose Up
CREATE TABLE expeditions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL,
    materials_invested INTEGER NOT NULL CHECK (materials_invested > 0),
    success_chance    DOUBLE PRECISION NOT NULL CHECK (success_chance BETWEEN 0 AND 1),
    resolve_at        TIMESTAMPTZ NOT NULL,
    status            TEXT NOT NULL DEFAULT 'IN_FLIGHT'
                      CHECK (status IN ('IN_FLIGHT', 'RESOLVED', 'FAILED')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at       TIMESTAMPTZ
);

CREATE INDEX expeditions_user_id_idx ON expeditions (user_id);
CREATE INDEX expeditions_current_idx ON expeditions (user_id, status)
    WHERE status = 'IN_FLIGHT';
CREATE INDEX expeditions_resolve_at_idx ON expeditions (status, resolve_at)
    WHERE status = 'IN_FLIGHT';

CREATE TABLE expedition_results (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expedition_id  UUID NOT NULL REFERENCES expeditions(id) ON DELETE CASCADE,
    outcome        TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE')),
    reward_summary JSONB NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX expedition_results_expedition_id_idx
    ON expedition_results (expedition_id);

CREATE TABLE user_ship_state_cache (
    user_id           UUID PRIMARY KEY,
    hull_health       INTEGER NOT NULL CHECK (hull_health BETWEEN 0 AND 100),
    materials_balance INTEGER NOT NULL CHECK (materials_balance >= 0),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
    id           BIGSERIAL PRIMARY KEY,
    event_id     UUID NOT NULL UNIQUE,
    event_type   TEXT NOT NULL,
    payload      JSONB NOT NULL,
    status       TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING', 'PUBLISHED')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
);

CREATE INDEX outbox_pending_idx ON outbox (created_at)
    WHERE status = 'PENDING';

-- +goose Down
DROP TABLE outbox;
DROP TABLE user_ship_state_cache;
DROP TABLE expedition_results;
DROP TABLE expeditions;
