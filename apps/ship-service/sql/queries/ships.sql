-- name: GetByUser :one
SELECT * FROM ships WHERE user_id = $1;

-- name: AddMaterials :one
UPDATE ships SET materials_balance = materials_balance + $2, updated_at = now() WHERE user_id = $1 RETURNING *;

-- name: ApplyDamage :one
UPDATE ships SET hull_health = GREATEST(0, hull_health - $2), updated_at = now() WHERE user_id = $1 RETURNING *;

-- name: Repair :one
UPDATE ships SET hull_health = LEAST(100, hull_health + $3), materials_balance = materials_balance - $2, updated_at = now() WHERE user_id = $1 RETURNING *;
