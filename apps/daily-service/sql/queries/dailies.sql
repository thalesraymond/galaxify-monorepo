-- name: CreateUserCache :exec
INSERT INTO users_cache (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;

-- name: CreateDaily :one
INSERT INTO dailies (
    user_id, title, description, difficulty, due_date
) VALUES (
    $1, $2, $3, $4, $5
) RETURNING *;

-- name: GetDaily :one
SELECT * FROM dailies WHERE id = $1 AND user_id = $2;

-- name: ListDailies :many
SELECT * FROM dailies WHERE user_id = $1 ORDER BY due_date ASC, created_at ASC;

-- name: UpdateDaily :one
UPDATE dailies SET
    title = COALESCE(sqlc.narg('title'), title),
    description = COALESCE(sqlc.narg('description'), description),
    difficulty = COALESCE(sqlc.narg('difficulty'), difficulty),
    due_date = COALESCE(sqlc.narg('due_date'), due_date),
    updated_at = now()
WHERE id = $1 AND user_id = $2 AND status = 'PENDING'
RETURNING *;

-- name: DeleteDaily :execrows
DELETE FROM dailies WHERE id = $1 AND user_id = $2 AND status = 'PENDING';

-- name: MarkDailyComplete :one
UPDATE dailies SET
    status = 'COMPLETED',
    updated_at = now()
WHERE id = $1 AND user_id = $2 AND status = 'PENDING'
RETURNING *;

-- name: MarkDailyMissed :one
UPDATE dailies SET
    status = 'MISSED',
    updated_at = now()
WHERE id = $1 AND status = 'PENDING'
RETURNING *;

-- name: GetDifficultyReward :one
SELECT * FROM difficulty_rewards WHERE difficulty = $1;

-- name: CreateDailyHistory :exec
INSERT INTO daily_history (
    daily_id, user_id, title, description, difficulty, due_date, status, completed_at, missed_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9
);
