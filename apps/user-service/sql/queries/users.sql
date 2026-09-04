-- name: InsertUser :one
INSERT INTO users (email, username, password_hash)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users
WHERE email = $1;

-- name: GetUserByID :one
SELECT * FROM users
WHERE id = $1;

-- name: UpdateUserUsername :one
UPDATE users
SET username = $1, updated_at = now()
WHERE id = $2
RETURNING *;

-- name: DeleteUserByID :exec
DELETE FROM users
WHERE id = $1;
