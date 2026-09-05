package cron

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/workers/daily-cron/internal/database"
)

// Worker scans for pending dailies whose due_date has passed and marks them MISSED.
//
// Event publication (daily.missed) is NOT performed here — it is deferred to
// the outbox implementation in https://github.com/thalesraymond/galaxify-monorepo/issues/20.
// Once that lands, the worker will write daily.missed rows to the outbox inside
// the same transaction, ensuring atomicity between status change and event.
type Worker struct {
	store     Store
	batchSize int32
	logger    *slog.Logger
	now       func() time.Time
}

// NewMissedDailyWorker creates a Worker that marks expired pending dailies as MISSED.
func NewMissedDailyWorker(store Store, opts ...WorkerOption) *Worker {
	w := &Worker{
		store:     store,
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

// Tick runs one full mark cycle: marks expired dailies MISSED in batches until
// no more are found.
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
	}
	return nil
}

// markBatch marks up to batchSize pending expired dailies as MISSED inside a
// single transaction (SKIP LOCKED prevents contention with concurrent instances).
// It returns the number of dailies processed.
//
// NOTE: daily.missed event publication is intentionally absent — it is blocked
// on https://github.com/thalesraymond/galaxify-monorepo/issues/20 (outbox pattern).
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
			if err := tx.MarkDailyMissed(ctx, daily.ID); err != nil {
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

// toTimestamptz converts a time.Time to pgtype.Timestamptz.
func toTimestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

// ensure toTimestamptz is referenced (used by pgTx; avoids dead-code lint if
// the function is only called from store.go in the same package).
var _ = toTimestamptz

// DailyRow is the subset of a daily row the worker needs.
type DailyRow = database.ListPendingExpiredDailiesRow
