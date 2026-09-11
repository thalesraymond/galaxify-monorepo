package expedition

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/workers/expedition-worker/internal/database"
)

var (
	userID       = uuid.MustParse("11111111-1111-1111-1111-111111111111")
	expeditionID = uuid.MustParse("33333333-3333-3333-3333-333333333333")
	fixedNow     = time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
)

func pgUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

// pendingExpedition builds an IN_FLIGHT expedition row due for resolution.
func pendingExpedition(materialsInvested int32, successChance float64) database.ListPendingExpeditionsRow {
	return database.ListPendingExpeditionsRow{
		ID:                pgUUID(expeditionID),
		UserID:            pgUUID(userID),
		MaterialsInvested: materialsInvested,
		SuccessChance:     successChance,
		ResolveAt:         pgtype.Timestamptz{Time: fixedNow.Add(-time.Hour), Valid: true},
	}
}

// listOnce builds a ListPendingExpeditions mock that returns the row on the
// first call and an empty batch afterwards, so Tick's batch loop terminates.
func listOnce(row database.ListPendingExpeditionsRow) func(_ context.Context, _ time.Time, _ int32) ([]database.ListPendingExpeditionsRow, error) {
	called := false
	return func(_ context.Context, _ time.Time, _ int32) ([]database.ListPendingExpeditionsRow, error) {
		if called {
			return nil, nil
		}
		called = true
		return []database.ListPendingExpeditionsRow{row}, nil
	}
}

// rollSequence returns a roller that pops deterministic values in order.
func rollSequence(t *testing.T, values ...float64) func() float64 {
	i := 0
	return func() float64 {
		if i >= len(values) {
			t.Errorf("unexpected extra roll call")
			return 0
		}
		v := values[i]
		i++
		return v
	}
}

// --- mocks ---

type mockTx struct {
	listPendingExpeditions func(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpeditionsRow, error)
	resolveExpedition      func(ctx context.Context, id pgtype.UUID, status string, now time.Time) error
	insertExpeditionResult func(ctx context.Context, expeditionID pgtype.UUID, outcome string, rewardSummary []byte) error
	insertOutbox           func(ctx context.Context, arg database.InsertOutboxParams) error
}

func (m *mockTx) ListPendingExpeditions(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpeditionsRow, error) {
	if m.listPendingExpeditions != nil {
		return m.listPendingExpeditions(ctx, before, limit)
	}
	return nil, nil
}

func (m *mockTx) ResolveExpedition(ctx context.Context, id pgtype.UUID, status string, now time.Time) error {
	if m.resolveExpedition != nil {
		return m.resolveExpedition(ctx, id, status, now)
	}
	return errors.New("unexpected ResolveExpedition call")
}

func (m *mockTx) InsertExpeditionResult(ctx context.Context, expeditionID pgtype.UUID, outcome string, rewardSummary []byte) error {
	if m.insertExpeditionResult != nil {
		return m.insertExpeditionResult(ctx, expeditionID, outcome, rewardSummary)
	}
	return errors.New("unexpected InsertExpeditionResult call")
}

func (m *mockTx) InsertOutbox(ctx context.Context, arg database.InsertOutboxParams) error {
	if m.insertOutbox != nil {
		return m.insertOutbox(ctx, arg)
	}
	return errors.New("unexpected InsertOutbox call")
}

type mockStore struct {
	withTx func(ctx context.Context, fn func(Tx) error) error
}

func (m *mockStore) WithTx(ctx context.Context, fn func(Tx) error) error {
	if m.withTx != nil {
		return m.withTx(ctx, fn)
	}
	return errors.New("unexpected WithTx call")
}

type mockDrainer struct {
	drain func(ctx context.Context, maxRows int32)
	calls int
}

func (m *mockDrainer) Drain(ctx context.Context, maxRows int32) {
	m.calls++
	if m.drain != nil {
		m.drain(ctx, maxRows)
	}
}

// newSilentLogger discards all log output (keeps test output clean).
func newSilentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// --- tests ---

func TestWorkerTickNoPendingExpeditions(t *testing.T) {
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpeditions: func(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpeditionsRow, error) {
					if !before.Equal(fixedNow) {
						t.Errorf("before = %v, want %v", before, fixedNow)
					}
					if limit != 100 {
						t.Errorf("limit = %d, want 100", limit)
					}
					return nil, nil
				},
			})
		},
	}
	drainer := &mockDrainer{drain: func(_ context.Context, _ int32) {
		t.Error("Drain should not be called when there are no pending expeditions")
	}}
	worker := NewResolutionWorker(store, drainer, WithClock(func() time.Time { return fixedNow }))

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}
}

func TestWorkerTickResolvesSuccessfulExpedition(t *testing.T) {
	var (
		resolvedStatus string
		resolvedAt     time.Time
		resultOutcome  string
		resultSummary  rewardSummary
		eventType      string
		eventPayload   events.ExpeditionCompleted
	)

	// success roll 0.49 < 0.5 success chance; multiplier roll 0.25 gives
	// 2.0 + (0.25 - 0.5) = 1.75x, so 100 invested -> 175 rewarded.
	// listPendingExpeditions is hoisted outside withTx so the "first call
	// only" flag survives across Tick's batch transactions.
	listPending := listOnce(pendingExpedition(100, 0.5))
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpeditions: listPending,
				resolveExpedition: func(_ context.Context, id pgtype.UUID, status string, now time.Time) error {
					if id != pgUUID(expeditionID) {
						t.Errorf("resolve id = %v, want %v", id, pgUUID(expeditionID))
					}
					resolvedStatus = status
					resolvedAt = now
					return nil
				},
				insertExpeditionResult: func(_ context.Context, id pgtype.UUID, outcome string, summary []byte) error {
					if id != pgUUID(expeditionID) {
						t.Errorf("result expedition_id = %v, want %v", id, pgUUID(expeditionID))
					}
					resultOutcome = outcome
					if err := json.Unmarshal(summary, &resultSummary); err != nil {
						return err
					}
					return nil
				},
				insertOutbox: func(_ context.Context, arg database.InsertOutboxParams) error {
					eventType = arg.EventType
					return json.Unmarshal(arg.Payload, &eventPayload)
				},
			})
		},
	}
	drainer := &mockDrainer{}
	worker := NewResolutionWorker(store, drainer,
		WithLogger(newSilentLogger()),
		WithClock(func() time.Time { return fixedNow }),
		WithRoller(rollSequence(t, 0.49, 0.25)),
	)

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}

	if resolvedStatus != StatusResolved {
		t.Errorf("resolved status = %q, want %q", resolvedStatus, StatusResolved)
	}
	if !resolvedAt.Equal(fixedNow) {
		t.Errorf("resolvedAt = %v, want %v", resolvedAt, fixedNow)
	}
	if resultOutcome != OutcomeSuccess {
		t.Errorf("result outcome = %q, want %q", resultOutcome, OutcomeSuccess)
	}
	if resultSummary.MaterialsReward != 175 {
		t.Errorf("reward summary materials_reward = %d, want 175", resultSummary.MaterialsReward)
	}
	if eventType != EventTypeCompleted {
		t.Errorf("event_type = %q, want %q", eventType, EventTypeCompleted)
	}
	if eventPayload.Version != 1 {
		t.Errorf("payload version = %d, want 1", eventPayload.Version)
	}
	if eventPayload.UserID != userID.String() {
		t.Errorf("payload user_id = %q, want %q", eventPayload.UserID, userID)
	}
	if eventPayload.ExpeditionID != expeditionID.String() {
		t.Errorf("payload expedition_id = %q, want %q", eventPayload.ExpeditionID, expeditionID)
	}
	if eventPayload.Outcome != OutcomeSuccess {
		t.Errorf("payload outcome = %q, want %q", eventPayload.Outcome, OutcomeSuccess)
	}
	if eventPayload.MaterialsReward != 175 {
		t.Errorf("payload materials_reward = %d, want 175", eventPayload.MaterialsReward)
	}
	if drainer.calls != 1 {
		t.Errorf("Drain calls = %d, want 1", drainer.calls)
	}
}

func TestWorkerTickFailsExpedition(t *testing.T) {
	var (
		resolvedStatus string
		resultOutcome  string
		resultSummary  rewardSummary
		eventPayload   events.ExpeditionCompleted
		rollCalls      int
	)

	// success roll 0.5 is not < 0.5 success chance, so the expedition fails
	// and no second (multiplier) roll is consumed.
	listPending := listOnce(pendingExpedition(100, 0.5))
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpeditions: listPending,
				resolveExpedition: func(_ context.Context, _ pgtype.UUID, status string, _ time.Time) error {
					resolvedStatus = status
					return nil
				},
				insertExpeditionResult: func(_ context.Context, _ pgtype.UUID, outcome string, summary []byte) error {
					resultOutcome = outcome
					return json.Unmarshal(summary, &resultSummary)
				},
				insertOutbox: func(_ context.Context, arg database.InsertOutboxParams) error {
					return json.Unmarshal(arg.Payload, &eventPayload)
				},
			})
		},
	}
	drainer := &mockDrainer{}
	worker := NewResolutionWorker(store, drainer,
		WithLogger(newSilentLogger()),
		WithClock(func() time.Time { return fixedNow }),
		WithRoller(func() float64 {
			rollCalls++
			return 0.5
		}),
	)

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}

	if rollCalls != 1 {
		t.Errorf("roll calls = %d, want 1 (no multiplier roll on failure)", rollCalls)
	}
	if resolvedStatus != StatusFailed {
		t.Errorf("resolved status = %q, want %q", resolvedStatus, StatusFailed)
	}
	if resultOutcome != OutcomeFailure {
		t.Errorf("result outcome = %q, want %q", resultOutcome, OutcomeFailure)
	}
	if resultSummary.MaterialsReward != 0 {
		t.Errorf("reward summary materials_reward = %d, want 0", resultSummary.MaterialsReward)
	}
	if eventPayload.Outcome != OutcomeFailure {
		t.Errorf("payload outcome = %q, want %q", eventPayload.Outcome, OutcomeFailure)
	}
	if eventPayload.MaterialsReward != 0 {
		t.Errorf("payload materials_reward = %d, want 0", eventPayload.MaterialsReward)
	}
	if drainer.calls != 1 {
		t.Errorf("Drain calls = %d, want 1", drainer.calls)
	}
}

func TestWorkerTickRewardMultiplierBounds(t *testing.T) {
	tests := []struct {
		name           string
		invested       int32
		multiplierRoll float64
		wantReward     int
	}{
		// 2.0 + (0 - 0.5) = 1.5x
		{"minimum multiplier", 100, 0, 150},
		// 2.0 + (0.5 - 0.5) = 2.0x
		{"average multiplier", 100, 0.5, 200},
		// 2.0 + (0.99 - 0.5) = 2.49x
		{"near-maximum multiplier", 100, 0.99, 249},
		// 3 * 1.5 = 4.5 rounds half away from zero to 5
		{"rounds half away from zero", 3, 0, 5},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var resultSummary rewardSummary
			listPending := listOnce(pendingExpedition(tt.invested, 1))
			store := &mockStore{
				withTx: func(ctx context.Context, fn func(Tx) error) error {
					return fn(&mockTx{
						listPendingExpeditions: listPending,
						resolveExpedition: func(_ context.Context, _ pgtype.UUID, _ string, _ time.Time) error {
							return nil
						},
						insertExpeditionResult: func(_ context.Context, _ pgtype.UUID, _ string, summary []byte) error {
							return json.Unmarshal(summary, &resultSummary)
						},
						insertOutbox: func(_ context.Context, _ database.InsertOutboxParams) error {
							return nil
						},
					})
				},
			}
			worker := NewResolutionWorker(store, &mockDrainer{},
				WithLogger(newSilentLogger()),
				WithClock(func() time.Time { return fixedNow }),
				// success roll 0 < 1 always succeeds; multiplier roll varies.
				WithRoller(rollSequence(t, 0, tt.multiplierRoll)),
			)

			if err := worker.Tick(context.Background()); err != nil {
				t.Fatalf("Tick returned error: %v", err)
			}
			if resultSummary.MaterialsReward != tt.wantReward {
				t.Errorf("materials_reward = %d, want %d", resultSummary.MaterialsReward, tt.wantReward)
			}
		})
	}
}

func TestWorkerTickProcessesMultipleBatches(t *testing.T) {
	var listCalls int
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpeditions: func(_ context.Context, _ time.Time, _ int32) ([]database.ListPendingExpeditionsRow, error) {
					listCalls++
					if listCalls == 1 {
						return []database.ListPendingExpeditionsRow{pendingExpedition(10, 1)}, nil
					}
					return nil, nil
				},
				resolveExpedition: func(_ context.Context, _ pgtype.UUID, _ string, _ time.Time) error {
					return nil
				},
				insertExpeditionResult: func(_ context.Context, _ pgtype.UUID, _ string, _ []byte) error {
					return nil
				},
				insertOutbox: func(_ context.Context, _ database.InsertOutboxParams) error {
					return nil
				},
			})
		},
	}
	drainer := &mockDrainer{}
	worker := NewResolutionWorker(store, drainer,
		WithLogger(newSilentLogger()),
		WithClock(func() time.Time { return fixedNow }),
		WithBatchSize(1),
		WithRoller(rollSequence(t, 0, 0.5)),
	)

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}

	// Batch 1 has a row, batch 2 is empty -> 2 calls.
	if listCalls != 2 {
		t.Errorf("ListPendingExpeditions calls = %d, want 2", listCalls)
	}
	if drainer.calls != 1 {
		t.Errorf("Drain calls = %d, want 1", drainer.calls)
	}
}

func TestWorkerTickListErrorReturnsError(t *testing.T) {
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpeditions: func(_ context.Context, _ time.Time, _ int32) ([]database.ListPendingExpeditionsRow, error) {
					return nil, errors.New("db read failed")
				},
			})
		},
	}
	drainer := &mockDrainer{drain: func(_ context.Context, _ int32) {
		t.Error("Drain must not be called when listing fails")
	}}
	worker := NewResolutionWorker(store, drainer, WithClock(func() time.Time { return fixedNow }))

	if err := worker.Tick(context.Background()); err == nil {
		t.Fatal("expected Tick to return error when listing fails")
	}
}

func TestWorkerTickResolveErrorReturnsError(t *testing.T) {
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpeditions: func(_ context.Context, _ time.Time, _ int32) ([]database.ListPendingExpeditionsRow, error) {
					return []database.ListPendingExpeditionsRow{pendingExpedition(10, 1)}, nil
				},
				resolveExpedition: func(_ context.Context, _ pgtype.UUID, _ string, _ time.Time) error {
					return errors.New("db write failed")
				},
			})
		},
	}
	drainer := &mockDrainer{drain: func(_ context.Context, _ int32) {
		t.Error("Drain must not be called when resolving fails")
	}}
	worker := NewResolutionWorker(store, drainer,
		WithClock(func() time.Time { return fixedNow }),
		WithRoller(rollSequence(t, 0, 0.5)),
	)

	if err := worker.Tick(context.Background()); err == nil {
		t.Fatal("expected Tick to return error when resolving fails")
	}
}

func TestWorkerTickInsertResultErrorReturnsError(t *testing.T) {
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpeditions: func(_ context.Context, _ time.Time, _ int32) ([]database.ListPendingExpeditionsRow, error) {
					return []database.ListPendingExpeditionsRow{pendingExpedition(10, 1)}, nil
				},
				resolveExpedition: func(_ context.Context, _ pgtype.UUID, _ string, _ time.Time) error {
					return nil
				},
				insertExpeditionResult: func(_ context.Context, _ pgtype.UUID, _ string, _ []byte) error {
					return errors.New("db write failed")
				},
			})
		},
	}
	drainer := &mockDrainer{drain: func(_ context.Context, _ int32) {
		t.Error("Drain must not be called when inserting the result fails")
	}}
	worker := NewResolutionWorker(store, drainer,
		WithClock(func() time.Time { return fixedNow }),
		WithRoller(rollSequence(t, 0, 0.5)),
	)

	if err := worker.Tick(context.Background()); err == nil {
		t.Fatal("expected Tick to return error when inserting the result fails")
	}
}

func TestWorkerTickOutboxFailureReturnsError(t *testing.T) {
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpeditions: func(_ context.Context, _ time.Time, _ int32) ([]database.ListPendingExpeditionsRow, error) {
					return []database.ListPendingExpeditionsRow{pendingExpedition(10, 1)}, nil
				},
				resolveExpedition: func(_ context.Context, _ pgtype.UUID, _ string, _ time.Time) error {
					return nil
				},
				insertExpeditionResult: func(_ context.Context, _ pgtype.UUID, _ string, _ []byte) error {
					return nil
				},
				insertOutbox: func(_ context.Context, _ database.InsertOutboxParams) error {
					return errors.New("outbox write failed")
				},
			})
		},
	}
	drainer := &mockDrainer{}
	worker := NewResolutionWorker(store, drainer,
		WithLogger(newSilentLogger()),
		WithClock(func() time.Time { return fixedNow }),
		WithRoller(rollSequence(t, 0, 0.5)),
	)

	if err := worker.Tick(context.Background()); err == nil {
		t.Fatal("expected Tick to return error when outbox staging fails")
	}
	if drainer.calls != 0 {
		t.Errorf("Drain calls = %d, want 0", drainer.calls)
	}
}
