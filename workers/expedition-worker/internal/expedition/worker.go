// Package expedition owns the expedition resolution worker: it settles
// IN_FLIGHT expeditions whose resolve_at has passed and stages the
// expedition.completed outbox event in the same transaction, giving
// at-least-once delivery via the shared outbox drainer (ADR-0004, ADR-0013).
package expedition

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"math/rand/v2"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
	"github.com/thalesraymond/galaxify-monorepo/workers/expedition-worker/internal/database"
)

const (
	// StatusInFlight is the status of an expedition awaiting resolution.
	StatusInFlight = "IN_FLIGHT"
	// StatusResolved is the status of an expedition that succeeded.
	StatusResolved = "RESOLVED"
	// StatusFailed is the status of an expedition that failed.
	StatusFailed = "FAILED"

	// OutcomeSuccess is recorded for a successful expedition.
	OutcomeSuccess = "SUCCESS"
	// OutcomeFailure is recorded for a failed expedition.
	OutcomeFailure = "FAILURE"

	// EventTypeCompleted is the event published when an expedition settles.
	EventTypeCompleted = "expedition.completed"

	// rewardMultiplierBase is the average reward multiplier (2.0x).
	rewardMultiplierBase = 2.0
	// rewardMultiplierJitter bounds the uniform multiplier deviation
	// (+/- 0.5), so the multiplier is uniform in [1.5, 2.5).
	rewardMultiplierJitter = 0.5

	drainBatchSize   = 50
	defaultBatchSize = 100
)

// Drainer publishes bounded batches of staged outbox events.
type Drainer interface {
	Drain(ctx context.Context, maxRows int32)
}

// Worker resolves expired IN_FLIGHT expeditions. For each expedition it rolls
// the dice against success_chance, computes the materials reward, updates the
// expedition status, records the expedition result, and stages an
// expedition.completed outbox event — all in one transaction.
type Worker struct {
	store     Store
	drainer   Drainer
	batchSize int32
	logger    *slog.Logger
	now       func() time.Time
	roll      func() float64
}

// NewResolutionWorker creates a Worker that settles expired IN_FLIGHT
// expeditions and stages expedition.completed events in the outbox.
func NewResolutionWorker(store Store, drainer Drainer, opts ...WorkerOption) *Worker {
	w := &Worker{
		store:     store,
		drainer:   drainer,
		batchSize: defaultBatchSize,
		logger:    slog.Default(),
		now:       time.Now,
		roll:      rand.Float64,
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

// WithRoller sets the dice function returning a uniform float in [0, 1).
// Useful in tests.
func WithRoller(roll func() float64) WorkerOption {
	return func(w *Worker) {
		w.roll = roll
	}
}

// Tick runs one resolution cycle: it settles expired IN_FLIGHT expeditions in
// batches until none remain, draining staged outbox events after each batch.
func (w *Worker) Tick(ctx context.Context) error {
	now := w.now().UTC()
	for {
		resolved, err := w.resolveBatch(ctx, now)
		if err != nil {
			return fmt.Errorf("resolve batch: %w", err)
		}
		if resolved == 0 {
			return nil
		}
		w.logger.Info("resolved expeditions", "count", resolved)
		w.drainer.Drain(ctx, drainBatchSize)
	}
}

// resolveBatch atomically settles up to batchSize expired IN_FLIGHT
// expeditions: status update, result row, and staged expedition.completed
// outbox event all happen inside a single transaction. It returns the number
// of expeditions settled.
func (w *Worker) resolveBatch(ctx context.Context, now time.Time) (int, error) {
	var resolved int
	err := w.store.WithTx(ctx, func(tx Tx) error {
		expeditions, err := tx.ListPendingExpeditions(ctx, now, w.batchSize)
		if err != nil {
			return err
		}
		if len(expeditions) == 0 {
			return nil
		}

		for _, expedition := range expeditions {
			status, outcome, reward := settleExpedition(expedition, w.roll)
			summary, err := json.Marshal(rewardSummary{MaterialsReward: reward})
			if err != nil {
				return fmt.Errorf("marshal reward summary for %v: %w", expedition.ID, err)
			}
			if err := tx.ResolveExpedition(ctx, expedition.ID, status, now); err != nil {
				return err
			}
			if err := tx.InsertExpeditionResult(ctx, expedition.ID, outcome, summary); err != nil {
				return err
			}
			payload, err := json.Marshal(events.ExpeditionCompleted{
				Version:         1,
				UserID:          sharedhttp.UUIDToString(expedition.UserID),
				ExpeditionID:    sharedhttp.UUIDToString(expedition.ID),
				Outcome:         outcome,
				MaterialsReward: reward,
			})
			if err != nil {
				return fmt.Errorf("marshal expedition.completed event: %w", err)
			}
			if err := tx.InsertOutbox(ctx, database.InsertOutboxParams{
				EventID:   pgtype.UUID{Bytes: uuid.New(), Valid: true},
				EventType: EventTypeCompleted,
				Payload:   payload,
			}); err != nil {
				return err
			}
		}

		resolved = len(expeditions)
		return nil
	})
	if err != nil {
		return 0, err
	}
	return resolved, nil
}

// settleExpedition rolls the dice against the expedition's success chance and
// returns the final status, outcome, and materials reward. On success the
// reward is materials_invested times a uniform multiplier in [1.5, 2.5)
// (average 2.0x), rounded to the nearest integer; on failure it is zero.
func settleExpedition(expedition database.ListPendingExpeditionsRow, roll func() float64) (status, outcome string, reward int) {
	if roll() >= expedition.SuccessChance {
		return StatusFailed, OutcomeFailure, 0
	}
	multiplier := rewardMultiplierBase + (roll() - rewardMultiplierJitter)
	return StatusResolved, OutcomeSuccess, int(math.Round(float64(expedition.MaterialsInvested) * multiplier))
}

// rewardSummary is the JSONB shape stored in expedition_results.reward_summary.
type rewardSummary struct {
	MaterialsReward int `json:"materials_reward"`
}
