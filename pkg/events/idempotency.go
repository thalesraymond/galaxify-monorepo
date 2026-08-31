package events

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
)

// ProcessedEventStore is the minimal query surface a consumer service needs
// to dedupe events on event_id. Each service's sqlc-generated *Queries type
// satisfies this interface directly, so consumers pass their local
// implementation straight in — no adapter required.
type ProcessedEventStore interface {
	InsertProcessedEvent(ctx context.Context, eventID pgtype.UUID) (int64, error)
	DeleteOldProcessedEvents(ctx context.Context) (int64, error)
}

// ProcessedEvents centralizes the idempotency bookkeeping for the
// processed_events table that every consumer service owns.
type ProcessedEvents struct {
	store ProcessedEventStore
}

// NewProcessedEvents wraps a consumer's local sqlc query executor.
func NewProcessedEvents(store ProcessedEventStore) *ProcessedEvents {
	return &ProcessedEvents{store: store}
}

// MarkProcessed records eventID as processed (the idempotency key). It
// returns true when the event is being processed for the first time — the
// caller should proceed with the work — and false when the event was already
// seen, in which case the caller should ack and skip.
func (p *ProcessedEvents) MarkProcessed(ctx context.Context, eventID string) (bool, error) {
	var id pgtype.UUID
	if err := id.Scan(eventID); err != nil {
		return false, fmt.Errorf("invalid event_id %q: %w", eventID, err)
	}

	rows, err := p.store.InsertProcessedEvent(ctx, id)
	if err != nil {
		return false, err
	}
	return rows == 1, nil
}

// PurgeOld deletes processed_events rows older than the retention window
// (30 days). Returns the number of rows deleted.
func (p *ProcessedEvents) PurgeOld(ctx context.Context) (int64, error) {
	return p.store.DeleteOldProcessedEvents(ctx)
}
