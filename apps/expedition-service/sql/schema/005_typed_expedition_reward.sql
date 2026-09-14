-- +goose Up
-- Replace the arbitrary reward_summary JSONB with a typed material reward so
-- expedition results have one stable shape across success and failure.
ALTER TABLE expedition_results
    ADD COLUMN materials_reward INTEGER NOT NULL DEFAULT 0;

UPDATE expedition_results
SET materials_reward = COALESCE((reward_summary ->> 'materials_reward')::integer, 0);

ALTER TABLE expedition_results DROP COLUMN reward_summary;

-- +goose Down
ALTER TABLE expedition_results
    ADD COLUMN reward_summary JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE expedition_results
SET reward_summary = jsonb_build_object('materials_reward', materials_reward);

ALTER TABLE expedition_results DROP COLUMN materials_reward;
