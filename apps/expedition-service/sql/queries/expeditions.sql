-- name: InsertExpedition :one
INSERT INTO expeditions (
    user_id, materials_invested, success_chance, resolve_at, status
) VALUES (
    $1, $2, $3, $4, $5
)
RETURNING *;

-- name: GetByID :one
SELECT * FROM expeditions
WHERE id = $1;

-- name: GetByIDAndUser :one
SELECT * FROM expeditions
WHERE id = $1 AND user_id = $2;

-- name: GetResultByExpedition :one
SELECT * FROM expedition_results
WHERE expedition_id = $1;

-- name: GetCurrentByUser :one
SELECT * FROM expeditions
WHERE user_id = $1 AND status = 'IN_FLIGHT'
ORDER BY created_at DESC
LIMIT 1;

-- name: ListByUser :many
SELECT * FROM expeditions
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: GetLastResolveAt :one
SELECT resolve_at FROM expeditions
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT 1;

-- name: InsertExpeditionResult :one
INSERT INTO expedition_results (
    expedition_id, outcome, reward_summary
) VALUES (
    $1, $2, $3
)
RETURNING *;
