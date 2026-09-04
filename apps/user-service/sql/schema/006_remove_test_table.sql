-- +goose Up
DROP TABLE test_table;

-- +goose Down
CREATE TABLE test_table (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL
);