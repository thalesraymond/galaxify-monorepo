package cron

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

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

type mockTx struct {
	listPendingExpiredDailies func(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpiredDailiesRow, error)
	getDamageAmount           func(ctx context.Context, difficulty string) (int32, error)
	markDailyMissed           func(ctx context.Context, dailyID pgtype.UUID) error
}

func (m *mockTx) ListPendingExpiredDailies(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpiredDailiesRow, error) {
	if m.listPendingExpiredDailies != nil {
		return m.listPendingExpiredDailies(ctx, before, limit)
	}
	return nil, errors.New("unexpected ListPendingExpiredDailies call")
}

func (m *mockTx) GetDamageAmount(ctx context.Context, difficulty string) (int32, error) {
	if m.getDamageAmount != nil {
		return m.getDamageAmount(ctx, difficulty)
	}
	return 0, errors.New("unexpected GetDamageAmount call")
}

func (m *mockTx) MarkDailyMissed(ctx context.Context, dailyID pgtype.UUID) error {
	if m.markDailyMissed != nil {
		return m.markDailyMissed(ctx, dailyID)
	}
	return errors.New("unexpected MarkDailyMissed call")
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
			})
		},
	}
	worker := NewMissedDailyWorker(store, WithClock(func() time.Time { return fixedNow }))

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}
}

func TestWorkerTickMarksExpiredDailyMissed(t *testing.T) {
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
							Difficulty: "MEDIUM",
						}}, nil
					}
					return nil, nil
				},
				markDailyMissed: func(ctx context.Context, id pgtype.UUID) error {
					if id != pgUUID(dailyID) {
						t.Errorf("daily_id = %v, want %v", id, pgUUID(dailyID))
					}
					return nil
				},
			})
		},
	}
	worker := NewMissedDailyWorker(store, WithClock(func() time.Time { return fixedNow }))

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}
}

func TestWorkerTickProcessesMultipleBatches(t *testing.T) {
	calls := 0
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpiredDailiesRow, error) {
					calls++
					if calls == 1 {
						return []database.ListPendingExpiredDailiesRow{
							{ID: pgUUID(dailyID), UserID: pgUUID(userID), Difficulty: "EASY"},
						}, nil
					}
					return nil, nil
				},
				markDailyMissed: func(ctx context.Context, id pgtype.UUID) error { return nil },
			})
		},
	}
	worker := NewMissedDailyWorker(store,
		WithClock(func() time.Time { return fixedNow }),
		WithBatchSize(1),
	)

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}

	// One batch with a row, then one empty batch to terminate the loop.
	if calls != 2 {
		t.Errorf("ListPendingExpiredDailies calls = %d, want 2", calls)
	}
}

func TestWorkerTickMarkDailyMissedError(t *testing.T) {
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpiredDailiesRow, error) {
					return []database.ListPendingExpiredDailiesRow{
						{ID: pgUUID(dailyID), UserID: pgUUID(userID), Difficulty: "HARD"},
					}, nil
				},
				markDailyMissed: func(ctx context.Context, id pgtype.UUID) error {
					return errors.New("db write failed")
				},
			})
		},
	}
	worker := NewMissedDailyWorker(store, WithClock(func() time.Time { return fixedNow }))

	err := worker.Tick(context.Background())
	if err == nil {
		t.Fatal("expected Tick to return error when MarkDailyMissed fails")
	}
}

func TestWorkerTickIdempotentDoubleCall(t *testing.T) {
	// Second Tick with no pending rows should be a safe no-op.
	calls := 0
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			calls++
			return fn(&mockTx{
				listPendingExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpiredDailiesRow, error) {
					return nil, nil
				},
			})
		},
	}
	worker := NewMissedDailyWorker(store, WithClock(func() time.Time { return fixedNow }))

	for range 2 {
		if err := worker.Tick(context.Background()); err != nil {
			t.Fatalf("Tick returned error: %v", err)
		}
	}
	if calls != 2 {
		t.Errorf("WithTx calls = %d, want 2", calls)
	}
}
