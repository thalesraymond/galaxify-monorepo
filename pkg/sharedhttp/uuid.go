package sharedhttp

import (
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// ParseUUID converts a UUID string into a pgtype.UUID.
func ParseUUID(s string) (pgtype.UUID, error) {
	id, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: id, Valid: true}, nil
}

// UUIDToString returns the standard string form of a pgtype.UUID.
func UUIDToString(u pgtype.UUID) string {
	return uuid.UUID(u.Bytes).String()
}
