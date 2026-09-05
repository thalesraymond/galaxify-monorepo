-- +goose Up
CREATE TABLE users_cache (
    id UUID PRIMARY KEY
);

CREATE TABLE difficulty_rewards (
    difficulty TEXT PRIMARY KEY,
    reward_materials INT NOT NULL,
    damage_amount INT NOT NULL
);

INSERT INTO difficulty_rewards (difficulty, reward_materials, damage_amount) VALUES
    ('EASY', 10, 5),
    ('MEDIUM', 20, 10),
    ('HARD', 30, 20);

CREATE TABLE dailies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users_cache(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    difficulty TEXT NOT NULL REFERENCES difficulty_rewards(difficulty),
    due_date TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX dailies_user_id_idx ON dailies(user_id);
CREATE INDEX dailies_status_due_date_idx ON dailies(status, due_date);

CREATE TABLE daily_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    daily_id UUID NOT NULL,
    user_id UUID NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    difficulty TEXT NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL,
    completed_at TIMESTAMPTZ,
    missed_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX daily_history_user_id_idx ON daily_history(user_id);

-- +goose Down
DROP TABLE daily_history;
DROP TABLE dailies;
DROP TABLE difficulty_rewards;
DROP TABLE users_cache;
