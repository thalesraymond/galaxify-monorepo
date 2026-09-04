-- name: InsertSigningKey :one
INSERT INTO jwt_keys (kid, private_key, public_key)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetLatestSigningKey :one
SELECT * FROM jwt_keys
ORDER BY created_at DESC
LIMIT 1;
