-- +goose Up
ALTER TABLE dailies
    ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC';

ALTER TABLE daily_history
    ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC';

-- +goose Down
ALTER TABLE daily_history DROP COLUMN time_zone;
ALTER TABLE dailies DROP COLUMN time_zone;
