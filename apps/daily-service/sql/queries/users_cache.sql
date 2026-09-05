-- name: UpsertUserCache :exec
INSERT INTO users_cache (id)
VALUES ($1)
ON CONFLICT (id) DO NOTHING;
