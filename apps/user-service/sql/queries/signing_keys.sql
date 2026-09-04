-- name: InsertSigningKey :one
INSERT INTO signing_keys (kid, private_key, public_key)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetLatestSigningKey :one
SELECT * FROM signing_keys
ORDER BY created_at DESC
LIMIT 1;
