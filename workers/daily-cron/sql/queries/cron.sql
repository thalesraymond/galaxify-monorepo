-- name: ListPendingExpiredDailies :many
-- Selects up to `batch_size` PENDING dailies whose due_date has passed,
-- locking them with SKIP LOCKED so concurrent worker instances don't collide.
SELECT id, user_id, title, description, difficulty, due_date
FROM dailies
WHERE status = 'PENDING' AND due_date < @before
ORDER BY due_date ASC
LIMIT @batch_size
FOR UPDATE SKIP LOCKED;

-- name: GetDamageAmount :one
SELECT damage_amount FROM difficulty_rewards WHERE difficulty = @difficulty;

-- name: CreateDailyHistory :exec
INSERT INTO daily_history (
    daily_id, user_id, title, description, difficulty, due_date, status, missed_at
) VALUES (
    $1, $2, $3, $4, $5, $6, 'MISSED', $7
);

-- name: RollOverPendingDaily :exec
-- Snaps due_date forward in 24-hour increments until due_date > now while remaining PENDING.
UPDATE dailies
SET due_date = due_date + CEIL(EXTRACT(EPOCH FROM (sqlc.arg('now')::timestamptz - due_date)) / 86400) * INTERVAL '1 day',
    updated_at = sqlc.arg('now')::timestamptz
WHERE id = @id AND status = 'PENDING';

-- name: ListCompletedExpiredDailies :many
-- Selects up to `batch_size` COMPLETED dailies whose due_date has passed,
-- locking them with SKIP LOCKED so concurrent worker instances don't collide.
SELECT id
FROM dailies
WHERE status = 'COMPLETED' AND due_date < @before
ORDER BY due_date ASC
LIMIT @batch_size
FOR UPDATE SKIP LOCKED;

-- name: ResetCompletedDaily :exec
-- Resets COMPLETED daily back to PENDING and advances due_date by 1 day.
UPDATE dailies
SET status = 'PENDING',
    due_date = due_date + INTERVAL '1 day',
    updated_at = sqlc.arg('now')::timestamptz
WHERE id = @id AND status = 'COMPLETED';

