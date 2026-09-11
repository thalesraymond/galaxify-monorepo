// Package timestamptz converts Go times into PostgreSQL timestamptz driver
// values for sqlc-generated query parameters.
package timestamptz

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// FromTime converts a time.Time into a valid pgtype.Timestamptz.
func FromTime(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}
