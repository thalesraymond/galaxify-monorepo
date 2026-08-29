-- name: CreateTestTable :one
INSERT INTO test_table (name)
VALUES ($1)
RETURNING *;

-- name: GetTestTable :one
SELECT * FROM test_table
WHERE id = $1;

-- name: ListTestTables :many
SELECT * FROM test_table
ORDER BY id;

-- name: UpdateTestTable :one
UPDATE test_table
SET name = $2
WHERE id = $1
RETURNING *;

-- name: DeleteTestTable :exec
DELETE FROM test_table
WHERE id = $1;