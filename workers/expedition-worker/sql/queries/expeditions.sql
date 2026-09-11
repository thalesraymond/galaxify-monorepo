-- name: ListPendingExpeditions :many
-- Selects up to `batch_size` IN_FLIGHT expeditions whose resolve_at has passed,
-- locking them with SKIP LOCKED so concurrent worker instances don't collide.
SELECT id, user_id, materials_invested, success_chance, resolve_at
FROM expeditions
WHERE status = 'IN_FLIGHT' AND resolve_at < @before
ORDER BY resolve_at ASC
LIMIT @batch_size
FOR UPDATE SKIP LOCKED;

-- name: ResolveExpedition :exec
UPDATE expeditions
SET status = @status,
    resolved_at = sqlc.arg('now')::timestamptz
WHERE id = @id AND status = 'IN_FLIGHT';

-- name: InsertExpeditionResult :exec
INSERT INTO expedition_results (
    expedition_id, outcome, reward_summary
) VALUES (
    $1, $2, $3
);
