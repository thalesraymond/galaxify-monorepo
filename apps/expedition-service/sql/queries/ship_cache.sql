-- name: SeedShipCache :exec
INSERT INTO user_ship_state_cache (
    user_id, hull_health, materials_balance
) VALUES (
    $1, $2, $3
)
ON CONFLICT (user_id) DO NOTHING;

-- name: UpsertShipCache :one
INSERT INTO user_ship_state_cache (
    user_id, hull_health, materials_balance
) VALUES (
    $1, $2, $3
)
ON CONFLICT (user_id) DO UPDATE SET
    hull_health = EXCLUDED.hull_health,
    materials_balance = EXCLUDED.materials_balance,
    updated_at = now()
RETURNING *;

-- name: GetShipCache :one
SELECT * FROM user_ship_state_cache
WHERE user_id = $1;
