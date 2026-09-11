-- +goose Up
ALTER TABLE outbox ADD COLUMN request_id TEXT;

-- +goose Down
ALTER TABLE outbox DROP COLUMN request_id;
