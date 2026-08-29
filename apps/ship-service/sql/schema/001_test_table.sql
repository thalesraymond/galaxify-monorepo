-- +goose Up
CREATE TABLE test_table (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL
);

-- +goose Down
DROP TABLE test_table;