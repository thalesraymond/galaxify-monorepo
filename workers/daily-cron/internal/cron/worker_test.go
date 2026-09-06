package cron

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/workers/daily-cron/internal/database"
)

var (
	userID   = uuid.MustParse("11111111-1111-1111-1111-111111111111")
	dailyID  = uuid.MustParse("22222222-2222-2222-2222-222222222222")
	fixedNow = time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
)

func pgUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

// --- mocks ---

type mockTx struct {
	listPendingExpiredDailies   func(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpiredDailiesRow, error)
	getDamageAmount             func(ctx context.Context, difficulty string) (int32, error)
	rollOverPendingDaily        func(ctx context.Context, daily database.ListPendingExpiredDailiesRow, now time.Time) error
	listCompletedExpiredDailies func(ctx context.Context, before time.Time, limit int32) ([]pgtype.UUID, error)
	resetCompletedDaily         func(ctx context.Context, id pgtype.UUID, now time.Time) error
}

func (m *mockTx) ListPendingExpiredDailies(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpiredDailiesRow, error) {
	if m.listPendingExpiredDailies != nil {
		return m.listPendingExpiredDailies(ctx, before, limit)
	}
	return nil, nil
}

func (m *mockTx) GetDamageAmount(ctx context.Context, difficulty string) (int32, error) {
	if m.getDamageAmount != nil {
		return m.getDamageAmount(ctx, difficulty)
	}
	return 0, errors.New("unexpected GetDamageAmount call")
}

func (m *mockTx) RollOverPendingDaily(ctx context.Context, daily database.ListPendingExpiredDailiesRow, now time.Time) error {
	if m.rollOverPendingDaily != nil {
		return m.rollOverPendingDaily(ctx, daily, now)
	}
	return errors.New("unexpected RollOverPendingDaily call")
}

func (m *mockTx) ListCompletedExpiredDailies(ctx context.Context, before time.Time, limit int32) ([]pgtype.UUID, error) {
	if m.listCompletedExpiredDailies != nil {
		return m.listCompletedExpiredDailies(ctx, before, limit)
	}
	return nil, nil
}

func (m *mockTx) ResetCompletedDaily(ctx context.Context, id pgtype.UUID, now time.Time) error {
	if m.resetCompletedDaily != nil {
		return m.resetCompletedDaily(ctx, id, now)
	}
	return errors.New("unexpected ResetCompletedDaily call")
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

type mockPublisher struct {
	publish func(ctx context.Context, eventType string, payload any, opts ...events.PublishOption) error
}

func (m *mockPublisher) Publish(ctx context.Context, eventType string, payload any, opts ...events.PublishOption) error {
	if m.publish != nil {
		return m.publish(ctx, eventType, payload, opts...)
	}
	return errors.New("unexpected Publish call")
}

// newSilentLogger discards all log output (keeps test output clean).
func newSilentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// --- tests ---

func TestWorkerTickNoExpiredDailies(t *testing.T) {
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpiredDailiesRow, error) {
					if !before.Equal(fixedNow) {
						t.Errorf("before = %v, want %v", before, fixedNow)
					}
					if limit != 500 {
						t.Errorf("limit = %d, want 500", limit)
					}
					return nil, nil
				},
				listCompletedExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]pgtype.UUID, error) {
					if !before.Equal(fixedNow) {
						t.Errorf("before = %v, want %v", before, fixedNow)
					}
					if limit != 500 {
						t.Errorf("limit = %d, want 500", limit)
					}
					return nil, nil
				},
			})
		},
	}
	publisher := &mockPublisher{publish: func(_ context.Context, _ string, _ any, _ ...events.PublishOption) error {
		t.Error("Publish should not be called when there are no expired dailies")
		return nil
	}}
	worker := NewMissedDailyWorker(store, publisher, WithClock(func() time.Time { return fixedNow }))

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}
}

func TestWorkerTickRollsOverExpiredPendingDailyAndPublishes(t *testing.T) {
	var (
		capturedEventType    string
		capturedDailyID      string
		capturedDamageAmount float64
		markCalls            int
		rolledOverDaily      *database.ListPendingExpiredDailiesRow
		rolledOverTime       time.Time
	)

	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpiredDailiesRow, error) {
					markCalls++
					if markCalls == 1 {
						return []database.ListPendingExpiredDailiesRow{{
							ID:          pgUUID(dailyID),
							UserID:      pgUUID(userID),
							Title:       "Morning run",
							Description: "5km",
							Difficulty:  "MEDIUM",
							DueDate:     pgtype.Timestamptz{Time: fixedNow.Add(-2 * time.Hour), Valid: true},
						}}, nil
					}
					return nil, nil
				},
				getDamageAmount: func(_ context.Context, difficulty string) (int32, error) {
					if difficulty != "MEDIUM" {
						t.Errorf("difficulty = %q, want MEDIUM", difficulty)
					}
					return 10, nil
				},
				rollOverPendingDaily: func(_ context.Context, daily database.ListPendingExpiredDailiesRow, now time.Time) error {
					rolledOverDaily = &daily
					rolledOverTime = now
					return nil
				},
			})
		},
	}
	publisher := &mockPublisher{
		publish: func(_ context.Context, eventType string, payload any, _ ...events.PublishOption) error {
			capturedEventType = eventType
			if p, ok := payload.(events.DailyMissed); ok {
				capturedDailyID = p.DailyID
				capturedDamageAmount = float64(p.DamageAmount)
			}
			return nil
		},
	}
	worker := NewMissedDailyWorker(store, publisher, WithClock(func() time.Time { return fixedNow }))

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}

	if rolledOverDaily == nil {
		t.Fatal("expected RollOverPendingDaily to be called")
	}
	if rolledOverDaily.ID != pgUUID(dailyID) {
		t.Errorf("rolledOverDaily.ID = %v, want %v", rolledOverDaily.ID, pgUUID(dailyID))
	}
	if rolledOverDaily.Title != "Morning run" {
		t.Errorf("rolledOverDaily.Title = %q, want Morning run", rolledOverDaily.Title)
	}
	if !rolledOverTime.Equal(fixedNow) {
		t.Errorf("rolledOverTime = %v, want %v", rolledOverTime, fixedNow)
	}
	if capturedEventType != "daily.missed" {
		t.Errorf("event_type = %q, want daily.missed", capturedEventType)
	}
	if capturedDailyID != dailyID.String() {
		t.Errorf("payload.daily_id = %v, want %v", capturedDailyID, dailyID.String())
	}
	if capturedDamageAmount != 10 {
		t.Errorf("payload.damage_amount = %v, want 10", capturedDamageAmount)
	}
}

func TestWorkerTickResetsExpiredCompletedDaily(t *testing.T) {
	var (
		completedCalls int
		resetDailyID   pgtype.UUID
		resetTime      time.Time
	)

	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listCompletedExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]pgtype.UUID, error) {
					completedCalls++
					if completedCalls == 1 {
						return []pgtype.UUID{pgUUID(dailyID)}, nil
					}
					return nil, nil
				},
				resetCompletedDaily: func(ctx context.Context, id pgtype.UUID, now time.Time) error {
					resetDailyID = id
					resetTime = now
					return nil
				},
			})
		},
	}
	publisher := &mockPublisher{
		publish: func(_ context.Context, _ string, _ any, _ ...events.PublishOption) error {
			t.Error("Publish should NOT be called during completed reset sweep")
			return nil
		},
	}
	worker := NewMissedDailyWorker(store, publisher, WithClock(func() time.Time { return fixedNow }))

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}

	if resetDailyID != pgUUID(dailyID) {
		t.Errorf("resetDailyID = %v, want %v", resetDailyID, pgUUID(dailyID))
	}
	if !resetTime.Equal(fixedNow) {
		t.Errorf("resetTime = %v, want %v", resetTime, fixedNow)
	}
}

func TestWorkerTickRunsBothSweeps(t *testing.T) {
	var (
		pendingProcessed   bool
		completedProcessed bool
		pendingCalls       int
		completedCalls     int
	)

	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpiredDailiesRow, error) {
					pendingCalls++
					if pendingCalls == 1 {
						return []database.ListPendingExpiredDailiesRow{{
							ID:         pgUUID(dailyID),
							UserID:     pgUUID(userID),
							Difficulty: "EASY",
						}}, nil
					}
					return nil, nil
				},
				getDamageAmount: func(_ context.Context, _ string) (int32, error) { return 5, nil },
				rollOverPendingDaily: func(_ context.Context, daily database.ListPendingExpiredDailiesRow, now time.Time) error {
					pendingProcessed = true
					return nil
				},
				listCompletedExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]pgtype.UUID, error) {
					completedCalls++
					if completedCalls == 1 {
						return []pgtype.UUID{pgUUID(dailyID)}, nil
					}
					return nil, nil
				},
				resetCompletedDaily: func(ctx context.Context, id pgtype.UUID, now time.Time) error {
					completedProcessed = true
					return nil
				},
			})
		},
	}
	publisher := &mockPublisher{publish: func(_ context.Context, _ string, _ any, _ ...events.PublishOption) error { return nil }}
	worker := NewMissedDailyWorker(store, publisher, WithClock(func() time.Time { return fixedNow }))

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}

	if !pendingProcessed {
		t.Errorf("pending sweep did not process daily")
	}
	if !completedProcessed {
		t.Errorf("completed sweep did not process daily")
	}
}

func TestWorkerTickProcessesMultipleBatches(t *testing.T) {
	pendingCalls := 0
	completedCalls := 0
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpiredDailiesRow, error) {
					pendingCalls++
					if pendingCalls == 1 {
						return []database.ListPendingExpiredDailiesRow{
							{ID: pgUUID(dailyID), UserID: pgUUID(userID), Difficulty: "EASY"},
						}, nil
					}
					return nil, nil
				},
				getDamageAmount: func(_ context.Context, _ string) (int32, error) { return 5, nil },
				rollOverPendingDaily: func(_ context.Context, _ database.ListPendingExpiredDailiesRow, _ time.Time) error {
					return nil
				},
				listCompletedExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]pgtype.UUID, error) {
					completedCalls++
					if completedCalls == 1 {
						return []pgtype.UUID{pgUUID(dailyID)}, nil
					}
					return nil, nil
				},
				resetCompletedDaily: func(ctx context.Context, id pgtype.UUID, now time.Time) error {
					return nil
				},
			})
		},
	}
	publisher := &mockPublisher{publish: func(_ context.Context, _ string, _ any, _ ...events.PublishOption) error { return nil }}
	worker := NewMissedDailyWorker(store, publisher,
		WithClock(func() time.Time { return fixedNow }),
		WithBatchSize(1),
	)

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}

	// For pending: batch 1 has row, batch 2 is empty -> 2 calls.
	if pendingCalls != 2 {
		t.Errorf("ListPendingExpiredDailies calls = %d, want 2", pendingCalls)
	}
	// For completed: batch 1 has row, batch 2 is empty -> 2 calls.
	if completedCalls != 2 {
		t.Errorf("ListCompletedExpiredDailies calls = %d, want 2", completedCalls)
	}
}

func TestWorkerTickPublishFailureIsLogged(t *testing.T) {
	var markCalls int
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpiredDailiesRow, error) {
					markCalls++
					if markCalls == 1 {
						return []database.ListPendingExpiredDailiesRow{{
							ID:         pgUUID(dailyID),
							UserID:     pgUUID(userID),
							Difficulty: "HARD",
						}}, nil
					}
					return nil, nil
				},
				getDamageAmount: func(_ context.Context, _ string) (int32, error) { return 20, nil },
				rollOverPendingDaily: func(_ context.Context, _ database.ListPendingExpiredDailiesRow, _ time.Time) error {
					return nil
				},
			})
		},
	}
	publisher := &mockPublisher{publish: func(_ context.Context, _ string, _ any, _ ...events.PublishOption) error {
		return errors.New("broker unavailable")
	}}
	worker := NewMissedDailyWorker(store, publisher,
		WithLogger(newSilentLogger()),
		WithClock(func() time.Time { return fixedNow }),
	)

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick must not return error on publish failure, got: %v", err)
	}
}

func TestWorkerTickRollOverPendingDailyError(t *testing.T) {
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpiredDailiesRow, error) {
					return []database.ListPendingExpiredDailiesRow{
						{ID: pgUUID(dailyID), UserID: pgUUID(userID), Difficulty: "HARD"},
					}, nil
				},
				rollOverPendingDaily: func(_ context.Context, _ database.ListPendingExpiredDailiesRow, _ time.Time) error {
					return errors.New("db write failed")
				},
			})
		},
	}
	publisher := &mockPublisher{publish: func(_ context.Context, _ string, _ any, _ ...events.PublishOption) error {
		t.Error("Publish must not be called when RollOverPendingDaily fails")
		return nil
	}}
	worker := NewMissedDailyWorker(store, publisher, WithClock(func() time.Time { return fixedNow }))

	if err := worker.Tick(context.Background()); err == nil {
		t.Fatal("expected Tick to return error when RollOverPendingDaily fails")
	}
}

func TestWorkerTickResetCompletedDailyError(t *testing.T) {
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listCompletedExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]pgtype.UUID, error) {
					return []pgtype.UUID{pgUUID(dailyID)}, nil
				},
				resetCompletedDaily: func(ctx context.Context, id pgtype.UUID, now time.Time) error {
					return errors.New("db write failed")
				},
			})
		},
	}
	publisher := &mockPublisher{publish: func(_ context.Context, _ string, _ any, _ ...events.PublishOption) error {
		return nil
	}}
	worker := NewMissedDailyWorker(store, publisher, WithClock(func() time.Time { return fixedNow }))

	if err := worker.Tick(context.Background()); err == nil {
		t.Fatal("expected Tick to return error when ResetCompletedDaily fails")
	}
}
