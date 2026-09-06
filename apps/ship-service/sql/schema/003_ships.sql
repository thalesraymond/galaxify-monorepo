-- +goose Up
CREATE TABLE ships (
    user_id           UUID PRIMARY KEY,
    hull_health       INTEGER NOT NULL DEFAULT 100 CHECK (hull_health BETWEEN 0 AND 100),
    materials_balance INTEGER NOT NULL DEFAULT 0 CHECK (materials_balance >= 0),
    level             INTEGER NOT NULL DEFAULT 1,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE ships;
