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
	"github.com/thalesraymond/galaxify-monorepo/workers/daily-cron/internal/database"
)

const dailyMissedEventType = "daily.missed"

// Drainer publishes bounded batches of staged outbox events.
type Drainer interface {
	Drain(ctx context.Context, maxRows int32)
}

// Worker scans for pending dailies whose due_date has passed, marks them
// MISSED, and stages a daily.missed event in the same transaction. The staged
// events are published by the shared outbox drainer, giving at-least-once
// delivery (ADR-0004).
type Worker struct {
	store     Store
	drainer   Drainer
	batchSize int32
	logger    *slog.Logger
	now       func() time.Time
}

// NewMissedDailyWorker creates a Worker that marks expired pending dailies as
// MISSED and stages daily.missed events in the outbox.
func NewMissedDailyWorker(store Store, drainer Drainer, opts ...WorkerOption) *Worker {
	w := &Worker{
		store:     store,
		drainer:   drainer,
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

// Tick runs one full mark and rollover cycle:
// 1. Missed Pending Sweep: finds expired PENDING dailies, records them in daily_history as MISSED,
// snaps due_date forward to the next cycle, and stages a daily.missed event.
// 2. Completed Reset Sweep: finds expired COMPLETED dailies, resets status to PENDING, and advances due_date by 1 day.
func (w *Worker) Tick(ctx context.Context) error {
	now := w.now().UTC()
	for {
		marked, err := w.markBatch(ctx, now)
		if err != nil {
			return fmt.Errorf("mark missed batch: %w", err)
		}
		if marked == 0 {
			break
		}
		w.logger.Info("marked dailies missed", "count", marked)
		w.drainer.Drain(ctx, 50)
	}

	for {
		resetCount, err := w.resetCompletedBatch(ctx, now)
		if err != nil {
			return fmt.Errorf("reset completed batch: %w", err)
		}
		if resetCount == 0 {
			break
		}
		w.logger.Info("reset completed dailies", "count", resetCount)
	}

	return nil
}

// markBatch atomically logs up to batchSize pending expired dailies to
// daily_history as MISSED, snaps their due_date forward, and stages a
// daily.missed outbox event for each inside a single transaction. It returns
// the number of dailies processed.
func (w *Worker) markBatch(ctx context.Context, now time.Time) (int, error) {
	var marked int
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
			if err := tx.RollOverPendingDaily(ctx, daily, now); err != nil {
				return err
			}
			payload, err := json.Marshal(events.DailyMissed{
				Version:      1,
				UserID:       sharedhttp.UUIDToString(daily.UserID),
				DailyID:      sharedhttp.UUIDToString(daily.ID),
				DamageAmount: int(damage),
			})
			if err != nil {
				return fmt.Errorf("marshal daily.missed event: %w", err)
			}
			if err := tx.InsertOutbox(ctx, database.InsertOutboxParams{
				EventID:   pgtype.UUID{Bytes: uuid.New(), Valid: true},
				EventType: dailyMissedEventType,
				Payload:   payload,
			}); err != nil {
				return err
			}
		}

		marked = len(dailies)
		return nil
	})
	if err != nil {
		return 0, err
	}
	return marked, nil
}

// resetCompletedBatch resets up to batchSize expired completed dailies to PENDING
// and advances due_date by 1 day inside a single transaction.
func (w *Worker) resetCompletedBatch(ctx context.Context, now time.Time) (int, error) {
	var count int
	err := w.store.WithTx(ctx, func(tx Tx) error {
		dailies, err := tx.ListCompletedExpiredDailies(ctx, now, w.batchSize)
		if err != nil {
			return err
		}
		if len(dailies) == 0 {
			return nil
		}

		for _, id := range dailies {
			if err := tx.ResetCompletedDaily(ctx, id, now); err != nil {
				return err
			}
		}

		count = len(dailies)
		return nil
	})
	if err != nil {
		return 0, err
	}
	return count, nil
}

// toTimestamptz converts a time.Time to pgtype.Timestamptz (used in store.go).
func toTimestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}
