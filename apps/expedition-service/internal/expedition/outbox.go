package expedition

import (
	"github.com/jackc/pgx/v5"

	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
)

// NewOutboxBatch adapts an Expedition database transaction to the shared outbox drainer.
func NewOutboxBatch(tx pgx.Tx) events.OutboxBatch {
	return events.NewOutboxBatch(tx, database.New(tx), func(row database.Outbox) events.OutboxRecord {
		return events.NewOutboxRecord(row.ID, row.EventID, row.EventType, row.Payload, row.RequestID.String, row.CreatedAt.Time)
	})
}
