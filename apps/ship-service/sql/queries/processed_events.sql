-- name: InsertProcessedEvent :execrows
INSERT INTO processed_events (event_id) VALUES ($1)
ON CONFLICT (event_id) DO NOTHING;

-- name: DeleteOldProcessedEvents :execrows
DELETE FROM processed_events WHERE processed_at < now() - interval '30 days';