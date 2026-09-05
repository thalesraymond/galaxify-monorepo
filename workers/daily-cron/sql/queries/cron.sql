-- name: ListPendingExpiredDailies :many
-- Selects up to `limit` PENDING dailies whose due_date has passed,
-- locking them with SKIP LOCKED so concurrent worker instances don't collide.
SELECT id, user_id, difficulty
FROM dailies
WHERE status = 'PENDING' AND due_date < @before
ORDER BY due_date ASC
LIMIT @batch_size
FOR UPDATE SKIP LOCKED;

-- name: GetDamageAmount :one
SELECT damage_amount FROM difficulty_rewards WHERE difficulty = @difficulty;

-- name: MarkDailyMissed :exec
-- Idempotent: WHERE clause on status = 'PENDING' prevents double-marking.
-- NOTE: daily.missed event publication is deferred to #20 (outbox pattern).
UPDATE dailies
SET status = 'MISSED', updated_at = now()
WHERE id = @id AND status = 'PENDING';
