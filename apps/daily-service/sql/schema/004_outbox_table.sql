-- +goose Up
CREATE TABLE outbox (
    id            BIGSERIAL PRIMARY KEY,
    event_id      UUID        NOT NULL UNIQUE,
    event_type    TEXT        NOT NULL,
    payload       JSONB       NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'PENDING',  -- PENDING | PUBLISHED
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ
);

CREATE INDEX outbox_pending_idx ON outbox (created_at) WHERE status = 'PENDING';

-- +goose Down
DROP TABLE outbox;
