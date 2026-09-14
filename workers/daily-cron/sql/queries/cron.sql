-- name: ListPendingExpiredDailies :many
-- Selects up to `batch_size` PENDING dailies whose due_date has passed,
-- locking them with SKIP LOCKED so concurrent worker instances don't collide.
SELECT id, user_id, title, description, difficulty, due_date, time_zone
FROM dailies
WHERE status = 'PENDING' AND due_date < @before
ORDER BY due_date ASC
LIMIT @batch_size
FOR UPDATE SKIP LOCKED;

-- name: GetDamageAmount :one
SELECT damage_amount FROM difficulty_rewards WHERE difficulty = @difficulty;

-- name: CreateDailyHistory :exec
INSERT INTO daily_history (
    daily_id, user_id, title, description, difficulty, due_date, time_zone, status, missed_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, 'MISSED', $8
);

-- name: RollOverPendingDaily :exec
UPDATE dailies
SET due_date = sqlc.arg('due_date')::timestamptz,
    updated_at = sqlc.arg('now')::timestamptz
WHERE id = @id AND status = 'PENDING';

-- name: ListCompletedExpiredDailies :many
-- Selects up to `batch_size` COMPLETED dailies whose due_date has passed,
-- locking them with SKIP LOCKED so concurrent worker instances don't collide.
SELECT id, due_date, time_zone
FROM dailies
WHERE status = 'COMPLETED' AND due_date < @before
ORDER BY due_date ASC
LIMIT @batch_size
FOR UPDATE SKIP LOCKED;

-- name: ResetCompletedDaily :exec
UPDATE dailies
SET status = 'PENDING',
    due_date = sqlc.arg('due_date')::timestamptz,
    updated_at = sqlc.arg('now')::timestamptz
WHERE id = @id AND status = 'COMPLETED';
