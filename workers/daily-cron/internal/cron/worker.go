package cron

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// Publisher publishes domain events to the event bus.
type Publisher interface {
	Publish(ctx context.Context, eventType string, payload any, opts ...events.PublishOption) error
}

// Worker scans for pending dailies whose due date has passed, marks them missed,
// writes daily.missed events to the outbox, and drains the outbox.
type Worker struct {
	store     Store
	publisher Publisher
	batchSize int32
	logger    *slog.Logger
	now       func() time.Time
}

// NewWorker creates a Worker that processes missed dailies in batches.
func NewWorker(store Store, publisher Publisher, opts ...WorkerOption) *Worker {
	w := &Worker{
		store:     store,
		publisher: publisher,
		batchSize: 500,
		logger:    slog.Default(),
		now:       time.Now,
	}
	for _, opt := range opts {
		opt(w)
	}
	return w
}

// WorkerOption configures a Worker.
type WorkerOption func(*Worker)

// WithBatchSize sets the batch size for each SELECT ... FOR UPDATE SKIP LOCKED.
func WithBatchSize(size int32) WorkerOption {
	return func(w *Worker) {
		w.batchSize = size
	}
}

// WithLogger sets the logger used by the worker.
func WithLogger(logger *slog.Logger) WorkerOption {
	return func(w *Worker) {
		w.logger = logger
	}
}

// WithClock sets the clock function used to determine the current UTC time.
// Useful in tests.
func WithClock(now func() time.Time) WorkerOption {
	return func(w *Worker) {
		w.now = now
	}
}

// Tick runs one full scan/drain cycle: drain any pending outbox rows, mark
// expired dailies missed in batches, and drain the resulting outbox rows.
func (w *Worker) Tick(ctx context.Context) error {
	now := w.now().UTC()

	if err := w.drainOutbox(ctx); err != nil {
		return fmt.Errorf("drain outbox before mark: %w", err)
	}

	for {
		marked, err := w.markBatch(ctx, now)
		if err != nil {
			return fmt.Errorf("mark missed batch: %w", err)
		}
		if marked == 0 {
			break
		}
		if err := w.drainOutbox(ctx); err != nil {
			return fmt.Errorf("drain outbox after mark: %w", err)
		}
	}

	return nil
}

// markBatch marks up to batchSize pending expired dailies as missed and writes
// a daily.missed outbox row for each. It returns the number of dailies processed.
func (w *Worker) markBatch(ctx context.Context, now time.Time) (int, error) {
	var processed int
	err := w.store.WithTx(ctx, func(tx Tx) error {
		dailies, err := tx.ListPendingExpiredDailies(ctx, now, w.batchSize)
		if err != nil {
			return err
		}
		if len(dailies) == 0 {
			return nil
		}

		for _, daily := range dailies {
			damage, err := tx.GetDamageAmount(ctx, daily.Difficulty)
			if err != nil {
				return err
			}

			if err := tx.MarkDailyMissed(ctx, daily.ID); err != nil {
				return err
			}

			payload, err := json.Marshal(events.DailyMissed{
				Version:      1,
				UserID:       sharedhttp.UUIDToString(daily.UserID),
				DailyID:      sharedhttp.UUIDToString(daily.ID),
				DamageAmount: int(damage),
			})
			if err != nil {
				return fmt.Errorf("marshal daily.missed payload: %w", err)
			}

			eventID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
			if err := tx.InsertOutbox(ctx, eventID, "daily.missed", payload); err != nil {
				return err
			}
		}

		processed = len(dailies)
		return nil
	})
	if err != nil {
		return 0, err
	}
	return processed, nil
}

// drainOutbox publishes up to batchSize pending outbox rows and marks them
// published. Rows that fail to publish stay pending and will be retried later.
func (w *Worker) drainOutbox(ctx context.Context) error {
	return w.store.WithTx(ctx, func(tx Tx) error {
		rows, err := tx.ListPendingOutbox(ctx, w.batchSize)
		if err != nil {
			return err
		}

		for _, row := range rows {
			var payload any
			if err := json.Unmarshal(row.Payload, &payload); err != nil {
				return fmt.Errorf("unmarshal outbox payload for id %d: %w", row.ID, err)
			}

			eventID := sharedhttp.UUIDToString(row.EventID)
			if err := w.publisher.Publish(ctx, row.EventType, payload, events.WithEventID(eventID)); err != nil {
				w.logger.Warn("outbox publish failed; will retry",
					"outbox_id", row.ID,
					"event_type", row.EventType,
					"error", err)
				continue
			}

			if err := tx.MarkOutboxPublished(ctx, row.ID); err != nil {
				w.logger.Warn("mark outbox published failed; will retry",
					"outbox_id", row.ID,
					"error", err)
				// Row stays PENDING; next drain will re-publish. Idempotency on
				// the consumer side (event_id dedup) handles duplicates.
				continue
			}
		}

		return nil
	})
}
