-- +goose Up
CREATE TABLE jwt_keys (
    kid         TEXT        PRIMARY KEY,
    private_key BYTEA       NOT NULL,
    public_key  BYTEA       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE jwt_keys;
