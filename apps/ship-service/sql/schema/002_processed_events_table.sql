-- +goose Up
CREATE TABLE processed_events (
    event_id     UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX processed_events_processed_at_idx ON processed_events (processed_at);

-- +goose Down
DROP TABLE processed_events;