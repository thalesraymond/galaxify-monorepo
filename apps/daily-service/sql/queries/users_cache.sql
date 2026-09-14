-- name: UpsertUserCache :exec
INSERT INTO users_cache (id)
VALUES ($1)
ON CONFLICT (id) DO NOTHING;

-- name: DeleteUserCache :exec
DELETE FROM users_cache WHERE id = $1;

-- name: UserCacheExists :one
SELECT EXISTS (SELECT 1 FROM users_cache WHERE id = $1);
