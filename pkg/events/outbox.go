package events

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// OutboxRecord is a transport-neutral pending event claimed from a service outbox.
type OutboxRecord struct {
	ID         int64
	EventID    string
	EventType  string
	Payload    json.RawMessage
	RequestID  string
	OccurredAt time.Time
}

// NewOutboxRecord maps the common outbox columns shared by every service's
// sqlc-generated Outbox row into the transport-neutral OutboxRecord.
func NewOutboxRecord(id int64, eventID pgtype.UUID, eventType string, payload []byte, requestID string, createdAt time.Time) OutboxRecord {
	return OutboxRecord{
		ID:         id,
		EventID:    uuid.UUID(eventID.Bytes).String(),
		EventType:  eventType,
		Payload:    append(json.RawMessage(nil), payload...),
		RequestID:  requestID,
		OccurredAt: createdAt,
	}
}

// OutboxBatch owns the transaction and locked rows for one bounded drain.
type OutboxBatch interface {
	ListPending(context.Context, int32) ([]OutboxRecord, error)
	MarkPublished(context.Context, int64) error
	Commit(context.Context) error
	Rollback(context.Context) error
}

// OutboxQueries is the sqlc-generated outbox surface of a service database.
// T is that service's outbox row type.
type OutboxQueries[T any] interface {
	ListPendingOutbox(ctx context.Context, limit int32) ([]T, error)
	MarkOutboxPublished(ctx context.Context, id int64) error
}

// NewOutboxBatch adapts a service transaction and its sqlc-generated outbox
// queries to the shared drainer. toRecord maps the service-specific row type to
// the transport-neutral OutboxRecord (see NewOutboxRecord).
func NewOutboxBatch[T any](tx pgx.Tx, queries OutboxQueries[T], toRecord func(T) OutboxRecord) OutboxBatch {
	return &sqlOutboxBatch[T]{tx: tx, queries: queries, toRecord: toRecord}
}

type sqlOutboxBatch[T any] struct {
	tx       pgx.Tx
	queries  OutboxQueries[T]
	toRecord func(T) OutboxRecord
}

func (batch *sqlOutboxBatch[T]) ListPending(ctx context.Context, maxRows int32) ([]OutboxRecord, error) {
	rows, err := batch.queries.ListPendingOutbox(ctx, maxRows)
	if err != nil {
		return nil, err
	}
	records := make([]OutboxRecord, 0, len(rows))
	for _, row := range rows {
		records = append(records, batch.toRecord(row))
	}
	return records, nil
}

func (batch *sqlOutboxBatch[T]) MarkPublished(ctx context.Context, id int64) error {
	return batch.queries.MarkOutboxPublished(ctx, id)
}

func (batch *sqlOutboxBatch[T]) Commit(ctx context.Context) error   { return batch.tx.Commit(ctx) }
func (batch *sqlOutboxBatch[T]) Rollback(ctx context.Context) error { return batch.tx.Rollback(ctx) }

// OutboxBatchStarter begins a transaction used to claim an outbox batch.
type OutboxBatchStarter func(context.Context) (OutboxBatch, error)

// OutboxDrainer publishes bounded batches from service-owned transactional outboxes.
type OutboxDrainer struct {
	mu         sync.Mutex
	beginBatch OutboxBatchStarter
	publisher  EventPublisher
	logger     *slog.Logger
}

// NewOutboxDrainer creates an HTTP-triggered outbox drainer.
func NewOutboxDrainer(beginBatch OutboxBatchStarter, publisher EventPublisher, logger *slog.Logger) *OutboxDrainer {
	if logger == nil {
		logger = slog.Default()
	}
	return &OutboxDrainer{beginBatch: beginBatch, publisher: publisher, logger: logger}
}

// DrainAfterRequest triggers a bounded drain after every handled HTTP request.
func (drainer *OutboxDrainer) DrainAfterRequest(next http.Handler, maxRows int32) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
		go drainer.Drain(context.WithoutCancel(r.Context()), maxRows)
	})
}

// Drain publishes up to maxRows pending events and marks acknowledged rows.
func (drainer *OutboxDrainer) Drain(ctx context.Context, maxRows int32) {
	if maxRows <= 0 {
		return
	}
	drainer.mu.Lock()
	defer drainer.mu.Unlock()

	batch, err := drainer.beginBatch(ctx)
	if err != nil {
		drainer.logger.WarnContext(ctx, "begin outbox drain transaction", "error", err)
		return
	}
	defer func() { _ = batch.Rollback(ctx) }()

	records, err := batch.ListPending(ctx, maxRows)
	if err != nil {
		drainer.logger.WarnContext(ctx, "list pending outbox events", "error", err)
		return
	}
	for _, record := range records {
		publishCtx := sharedhttp.WithRequestID(ctx, record.RequestID)
		if err := drainer.publisher.Publish(publishCtx, record.EventType, record.Payload, WithEventID(record.EventID), WithOccurredAt(record.OccurredAt)); err != nil {
			drainer.logger.WarnContext(ctx, "publish outbox event", "event_id", record.EventID, "event_type", record.EventType, "error", err)
			continue
		}
		if err := batch.MarkPublished(ctx, record.ID); err != nil {
			drainer.logger.WarnContext(ctx, "mark outbox event published", "event_id", record.EventID, "error", err)
			return
		}
	}
	if err := batch.Commit(ctx); err != nil {
		drainer.logger.WarnContext(ctx, "commit outbox drain transaction", "error", err)
	}
}
