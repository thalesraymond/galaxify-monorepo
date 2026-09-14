-- name: CreateUserCache :exec
INSERT INTO users_cache (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;

-- name: CreateDaily :one
INSERT INTO dailies (
    user_id, title, description, difficulty, due_date, time_zone
) VALUES (
    $1, $2, $3, $4, $5, $6
) RETURNING *;

-- name: GetDaily :one
SELECT * FROM dailies WHERE id = $1 AND user_id = $2;

-- name: ListDailies :many
SELECT * FROM dailies
WHERE user_id = $1
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'))
  AND (sqlc.narg('from')::timestamptz IS NULL OR due_date >= sqlc.narg('from'))
  AND (sqlc.narg('to')::timestamptz IS NULL OR due_date < sqlc.narg('to'))
ORDER BY due_date ASC, created_at ASC;

-- name: UpdateDaily :one
UPDATE dailies SET
    title = COALESCE(sqlc.narg('title'), title),
    description = COALESCE(sqlc.narg('description'), description),
    difficulty = COALESCE(sqlc.narg('difficulty'), difficulty),
    due_date = COALESCE(sqlc.narg('due_date'), due_date),
    time_zone = COALESCE(sqlc.narg('time_zone'), time_zone),
    updated_at = now()
WHERE id = $1 AND user_id = $2
RETURNING *;

-- name: DeleteDaily :execrows
DELETE FROM dailies WHERE id = $1 AND user_id = $2;

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

-- name: ListDifficultyRewards :many
-- Canonical tier order (EASY, MEDIUM, HARD) so the metadata endpoint is stable.
SELECT * FROM difficulty_rewards
ORDER BY CASE difficulty
    WHEN 'EASY' THEN 1
    WHEN 'MEDIUM' THEN 2
    WHEN 'HARD' THEN 3
    ELSE 4
END;

-- name: CreateDailyHistory :exec
INSERT INTO daily_history (
    daily_id, user_id, title, description, difficulty, due_date, time_zone, status, completed_at, missed_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
);

-- name: ListDailyHistory :many
-- Stable descending keyset page over the (due_date, archived_at, id) tuple.
-- `id` is the unique tie-breaker required by the continuation contract. The
-- cursor nargs are all-or-nothing: when they are NULL the first page is read.
SELECT * FROM daily_history
WHERE user_id = $1
  AND (
    sqlc.narg('cursor_due_date')::timestamptz IS NULL
    OR (due_date, archived_at, id) < (
        sqlc.narg('cursor_due_date')::timestamptz,
        sqlc.narg('cursor_archived_at')::timestamptz,
        sqlc.narg('cursor_id')::uuid
    )
  )
ORDER BY due_date DESC, archived_at DESC, id DESC
LIMIT sqlc.arg('page_size')::int;
