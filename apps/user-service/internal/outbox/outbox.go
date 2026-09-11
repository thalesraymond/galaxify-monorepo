// Package outbox adapts the user-service database layer to the shared outbox drainer.
package outbox

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
)

// NewOutboxBatch adapts a user-service database transaction to the shared outbox drainer.
func NewOutboxBatch(tx pgx.Tx) events.OutboxBatch {
	return &outboxBatch{tx: tx, store: database.New(tx)}
}

type outboxBatch struct {
	tx    pgx.Tx
	store *database.Queries
}

func (batch *outboxBatch) ListPending(ctx context.Context, maxRows int32) ([]events.OutboxRecord, error) {
	rows, err := batch.store.ListPendingOutbox(ctx, maxRows)
	if err != nil {
		return nil, err
	}
	records := make([]events.OutboxRecord, 0, len(rows))
	for _, row := range rows {
		records = append(records, events.OutboxRecord{
			ID: row.ID, EventID: uuid.UUID(row.EventID.Bytes).String(), EventType: row.EventType,
			Payload: append([]byte(nil), row.Payload...), RequestID: row.RequestID.String,
			OccurredAt: row.CreatedAt.Time,
		})
	}
	return records, nil
}

func (batch *outboxBatch) MarkPublished(ctx context.Context, id int64) error {
	return batch.store.MarkOutboxPublished(ctx, id)
}

func (batch *outboxBatch) Commit(ctx context.Context) error   { return batch.tx.Commit(ctx) }
func (batch *outboxBatch) Rollback(ctx context.Context) error { return batch.tx.Rollback(ctx) }

var _ events.OutboxBatch = (*outboxBatch)(nil)
