package events

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

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

// OutboxBatch owns the transaction and locked rows for one bounded drain.
type OutboxBatch interface {
	ListPending(context.Context, int32) ([]OutboxRecord, error)
	MarkPublished(context.Context, int64) error
	Commit(context.Context) error
	Rollback(context.Context) error
}

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
