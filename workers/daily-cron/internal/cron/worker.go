package cron

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
	"github.com/thalesraymond/galaxify-monorepo/workers/daily-cron/internal/database"
)

// Publisher publishes domain events to the event bus.
type Publisher interface {
	Publish(ctx context.Context, eventType string, payload any, opts ...events.PublishOption) error
}

// Worker scans for pending dailies whose due_date has passed, marks them
// MISSED, and publishes a daily.missed event for each one.
//
// NOTE: publishing is best-effort here (naive publish, no outbox). The daily is
// already committed as MISSED before the publish call, so a broker failure will
// cause the event to be dropped without rolling back the status change. Full
// at-least-once delivery via the transactional outbox is tracked in
// https://github.com/thalesraymond/galaxify-monorepo/issues/20 — once that
// lands the publisher field and post-commit publish loop will be replaced by
// outbox inserts inside the transaction.
type Worker struct {
	store     Store
	publisher Publisher
	batchSize int32
	logger    *slog.Logger
	now       func() time.Time
}

// NewMissedDailyWorker creates a Worker that marks expired pending dailies as MISSED
// and publishes daily.missed events.
func NewMissedDailyWorker(store Store, publisher Publisher, opts ...WorkerOption) *Worker {
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

// Tick runs one full mark cycle: marks expired dailies MISSED in batches, then
// publishes a daily.missed event for each one outside the transaction.
func (w *Worker) Tick(ctx context.Context) error {
	now := w.now().UTC()
	for {
		marked, err := w.markBatch(ctx, now)
		if err != nil {
			return fmt.Errorf("mark missed batch: %w", err)
		}
		if len(marked) == 0 {
			break
		}
		w.logger.Info("marked dailies missed", "count", len(marked))
		w.publishBatch(ctx, marked)
	}
	return nil
}

// markBatch marks up to batchSize pending expired dailies as MISSED inside a
// single transaction (SKIP LOCKED prevents contention with concurrent instances).
// It returns the rows that were marked so the caller can publish events for them.
func (w *Worker) markBatch(ctx context.Context, now time.Time) ([]database.ListPendingExpiredDailiesRow, error) {
	var marked []database.ListPendingExpiredDailiesRow
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

		marked = dailies
		return nil
	})
	if err != nil {
		return nil, err
	}
	return marked, nil
}

// publishBatch publishes a daily.missed event for each row in marked.
// Publishing is best-effort: a broker failure logs a warning but does not roll
// back the MISSED status already committed to the database.
// Full at-least-once delivery is tracked in issue #20 (outbox pattern).
func (w *Worker) publishBatch(ctx context.Context, marked []database.ListPendingExpiredDailiesRow) {
	for _, daily := range marked {
		damage, err := w.getDamageAmount(ctx, daily.Difficulty)
		if err != nil {
			w.logger.Warn("could not look up damage amount for daily.missed publish; skipping",
				"daily_id", sharedhttp.UUIDToString(daily.ID),
				"difficulty", daily.Difficulty,
				"error", err,
			)
			continue
		}

		if err := w.publisher.Publish(ctx, "daily.missed", events.DailyMissed{
			Version:      1,
			UserID:       sharedhttp.UUIDToString(daily.UserID),
			DailyID:      sharedhttp.UUIDToString(daily.ID),
			DamageAmount: int(damage),
		}); err != nil {
			w.logger.Warn("daily.missed publish failed; event dropped (no outbox yet, see #20)",
				"daily_id", sharedhttp.UUIDToString(daily.ID),
				"error", err,
			)
		}
	}
}

// getDamageAmount fetches the damage amount for a given difficulty in a
// read-only transaction.
func (w *Worker) getDamageAmount(ctx context.Context, difficulty string) (int32, error) {
	var damage int32
	err := w.store.WithTx(ctx, func(tx Tx) error {
		d, err := tx.GetDamageAmount(ctx, difficulty)
		if err != nil {
			return err
		}
		damage = d
		return nil
	})
	return damage, err
}

// toTimestamptz converts a time.Time to pgtype.Timestamptz (used in store.go).
func toTimestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}
