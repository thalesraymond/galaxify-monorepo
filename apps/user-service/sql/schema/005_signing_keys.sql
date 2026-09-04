-- +goose Up
CREATE TABLE signing_keys (
    kid         TEXT        PRIMARY KEY,
    private_key BYTEA       NOT NULL,
    public_key  BYTEA       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE signing_keys;
