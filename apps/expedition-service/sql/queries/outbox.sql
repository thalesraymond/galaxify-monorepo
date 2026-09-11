-- name: InsertOutbox :exec
INSERT INTO outbox (event_id, event_type, payload, request_id)
VALUES ($1, $2, $3, $4);

-- name: ListPendingOutbox :many
SELECT * FROM outbox
WHERE status = 'PENDING'
ORDER BY created_at ASC
LIMIT $1
FOR UPDATE SKIP LOCKED;

-- name: MarkOutboxPublished :exec
UPDATE outbox
SET status = 'PUBLISHED', published_at = now()
WHERE id = $1;
