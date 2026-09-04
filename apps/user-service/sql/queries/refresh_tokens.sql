-- name: InsertRefreshToken :one
INSERT INTO refresh_tokens (user_id, token, family_id, expires_at)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetRefreshTokenByToken :one
SELECT * FROM refresh_tokens
WHERE token = $1;

-- name: MarkRefreshTokenUsed :exec
UPDATE refresh_tokens
SET used = true
WHERE id = $1;

-- name: DeleteRefreshTokensByFamilyID :exec
DELETE FROM refresh_tokens
WHERE family_id = $1;

-- name: DeleteExpiredRefreshTokens :exec
DELETE FROM refresh_tokens
WHERE expires_at < now();
