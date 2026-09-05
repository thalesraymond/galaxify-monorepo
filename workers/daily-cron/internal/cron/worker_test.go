package cron

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
)

var (
	userID   = uuid.MustParse("11111111-1111-1111-1111-111111111111")
	dailyID  = uuid.MustParse("22222222-2222-2222-2222-222222222222")
	eventID  = uuid.MustParse("33333333-3333-3333-3333-333333333333")
	fixedNow = time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
)

func pgUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

type mockTx struct {
	listPendingExpiredDailies func(ctx context.Context, before time.Time, limit int32) ([]DailyRow, error)
	getDamageAmount           func(ctx context.Context, difficulty string) (int32, error)
	markDailyMissed           func(ctx context.Context, dailyID pgtype.UUID) error
	insertOutbox              func(ctx context.Context, eventID pgtype.UUID, eventType string, payload []byte) error
	listPendingOutbox         func(ctx context.Context, limit int32) ([]OutboxRow, error)
	markOutboxPublished       func(ctx context.Context, id int64) error
}

func (m *mockTx) ListPendingExpiredDailies(ctx context.Context, before time.Time, limit int32) ([]DailyRow, error) {
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

func (m *mockTx) InsertOutbox(ctx context.Context, eventID pgtype.UUID, eventType string, payload []byte) error {
	if m.insertOutbox != nil {
		return m.insertOutbox(ctx, eventID, eventType, payload)
	}
	return errors.New("unexpected InsertOutbox call")
}

func (m *mockTx) ListPendingOutbox(ctx context.Context, limit int32) ([]OutboxRow, error) {
	if m.listPendingOutbox != nil {
		return m.listPendingOutbox(ctx, limit)
	}
	return nil, errors.New("unexpected ListPendingOutbox call")
}

func (m *mockTx) MarkOutboxPublished(ctx context.Context, id int64) error {
	if m.markOutboxPublished != nil {
		return m.markOutboxPublished(ctx, id)
	}
	return errors.New("unexpected MarkOutboxPublished call")
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

func hasEventIDOpt(opts []events.PublishOption) bool {
	return len(opts) > 0
}

func TestWorkerTickNoExpiredDailies(t *testing.T) {
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]DailyRow, error) {
					if !before.Equal(fixedNow) {
						t.Errorf("before = %v, want %v", before, fixedNow)
					}
					if limit != 500 {
						t.Errorf("limit = %d, want 500", limit)
					}
					return nil, nil
				},
				listPendingOutbox: func(ctx context.Context, limit int32) ([]OutboxRow, error) {
					return nil, nil
				},
			})
		},
	}
	publisher := &mockPublisher{}
	worker := NewWorker(store, publisher, WithClock(func() time.Time { return fixedNow }))

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}
}

func TestWorkerTickMarksExpiredDailyAndDrains(t *testing.T) {
	var (
		capturedEventType string
		capturedPayload   map[string]any
		capturedEventID   string
		markCalls         int
	)

	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]DailyRow, error) {
					markCalls++
					if markCalls == 1 {
						return []DailyRow{{
							ID:         pgUUID(dailyID),
							UserID:     pgUUID(userID),
							Difficulty: "MEDIUM",
						}}, nil
					}
					return nil, nil
				},
				getDamageAmount: func(ctx context.Context, difficulty string) (int32, error) {
					if difficulty != "MEDIUM" {
						t.Errorf("difficulty = %q, want MEDIUM", difficulty)
					}
					return 10, nil
				},
				markDailyMissed: func(ctx context.Context, id pgtype.UUID) error {
					if id != pgUUID(dailyID) {
						t.Errorf("daily_id = %v, want %v", id, pgUUID(dailyID))
					}
					return nil
				},
				insertOutbox: func(ctx context.Context, id pgtype.UUID, eventType string, payload []byte) error {
					if eventType != "daily.missed" {
						t.Errorf("event_type = %q, want daily.missed", eventType)
					}
					return nil
				},
				listPendingOutbox: func(ctx context.Context, limit int32) ([]OutboxRow, error) {
					return []OutboxRow{{
						ID:        1,
						EventID:   pgUUID(eventID),
						EventType: "daily.missed",
						Payload:   []byte(`{"version":1,"user_id":"` + userID.String() + `","daily_id":"` + dailyID.String() + `","damage_amount":10}`),
					}}, nil
				},
				markOutboxPublished: func(ctx context.Context, id int64) error {
					if id != 1 {
						t.Errorf("outbox_id = %d, want 1", id)
					}
					return nil
				},
			})
		},
	}
	publisher := &mockPublisher{
		publish: func(ctx context.Context, eventType string, payload any, opts ...events.PublishOption) error {
			capturedEventType = eventType
			capturedPayload, _ = payload.(map[string]any)
			if !hasEventIDOpt(opts) {
				t.Error("expected event id option to be provided")
			}
			capturedEventID = "provided"
			return nil
		},
	}
	worker := NewWorker(store, publisher, WithClock(func() time.Time { return fixedNow }))

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}

	if capturedEventType != "daily.missed" {
		t.Errorf("event_type = %q, want daily.missed", capturedEventType)
	}
	if capturedPayload["daily_id"] != dailyID.String() {
		t.Errorf("payload.daily_id = %v, want %v", capturedPayload["daily_id"], dailyID.String())
	}
	if capturedPayload["damage_amount"] != float64(10) {
		t.Errorf("payload.damage_amount = %v, want 10", capturedPayload["damage_amount"])
	}
	if capturedEventID != "provided" {
		t.Error("expected explicit event id option")
	}
}

func TestWorkerTickProcessesMultipleBatches(t *testing.T) {
	calls := 0
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]DailyRow, error) {
					calls++
					if calls == 1 {
						return []DailyRow{{ID: pgUUID(dailyID), UserID: pgUUID(userID), Difficulty: "EASY"}}, nil
					}
					return nil, nil
				},
				getDamageAmount: func(ctx context.Context, difficulty string) (int32, error) { return 5, nil },
				markDailyMissed: func(ctx context.Context, id pgtype.UUID) error { return nil },
				insertOutbox:    func(ctx context.Context, id pgtype.UUID, eventType string, payload []byte) error { return nil },
				listPendingOutbox: func(ctx context.Context, limit int32) ([]OutboxRow, error) {
					return nil, nil
				},
				markOutboxPublished: func(ctx context.Context, id int64) error { return nil },
			})
		},
	}
	publisher := &mockPublisher{publish: func(ctx context.Context, eventType string, payload any, opts ...events.PublishOption) error {
		return nil
	}}
	worker := NewWorker(store, publisher,
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

func TestWorkerTickDrainsExistingOutboxBeforeMarking(t *testing.T) {
	drained := false
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]DailyRow, error) {
					return nil, nil
				},
				listPendingOutbox: func(ctx context.Context, limit int32) ([]OutboxRow, error) {
					if !drained {
						drained = true
						return []OutboxRow{{ID: 7, EventID: pgUUID(eventID), EventType: "daily.missed", Payload: []byte(`{"version":1}`)}}, nil
					}
					return nil, nil
				},
				markOutboxPublished: func(ctx context.Context, id int64) error {
					if id != 7 {
						t.Errorf("outbox_id = %d, want 7", id)
					}
					return nil
				},
			})
		},
	}
	publisher := &mockPublisher{publish: func(ctx context.Context, eventType string, payload any, opts ...events.PublishOption) error {
		return nil
	}}
	worker := NewWorker(store, publisher, WithClock(func() time.Time { return fixedNow }))

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}
	if !drained {
		t.Error("expected existing outbox row to be drained")
	}
}

func TestWorkerTickPublishFailureLeavesRowPending(t *testing.T) {
	markedPublished := false
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]DailyRow, error) { return nil, nil },
				listPendingOutbox: func(ctx context.Context, limit int32) ([]OutboxRow, error) {
					return []OutboxRow{{ID: 1, EventID: pgUUID(eventID), EventType: "daily.missed", Payload: []byte(`{"version":1}`)}}, nil
				},
				markOutboxPublished: func(ctx context.Context, id int64) error {
					markedPublished = true
					return nil
				},
			})
		},
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	publisher := &mockPublisher{publish: func(ctx context.Context, eventType string, payload any, opts ...events.PublishOption) error {
		return errors.New("broker unavailable")
	}}
	worker := NewWorker(store, publisher, WithLogger(logger), WithClock(func() time.Time { return fixedNow }))

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}
	if markedPublished {
		t.Error("expected outbox row to stay pending when publish fails")
	}
}

func TestWorkerTickMarkPublishedFailureLeavesRowPending(t *testing.T) {
	publishedCount := 0
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]DailyRow, error) { return nil, nil },
				listPendingOutbox: func(ctx context.Context, limit int32) ([]OutboxRow, error) {
					return []OutboxRow{{ID: 1, EventID: pgUUID(eventID), EventType: "daily.missed", Payload: []byte(`{"version":1}`)}}, nil
				},
				markOutboxPublished: func(ctx context.Context, id int64) error {
					return errors.New("update failed")
				},
			})
		},
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	publisher := &mockPublisher{publish: func(ctx context.Context, eventType string, payload any, opts ...events.PublishOption) error {
		publishedCount++
		return nil
	}}
	worker := NewWorker(store, publisher, WithLogger(logger), WithClock(func() time.Time { return fixedNow }))

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}
	if publishedCount != 1 {
		t.Errorf("publish calls = %d, want 1", publishedCount)
	}
}

func TestWorkerTickMarshalPayload(t *testing.T) {
	calls := 0
	store := &mockStore{
		withTx: func(ctx context.Context, fn func(Tx) error) error {
			return fn(&mockTx{
				listPendingExpiredDailies: func(ctx context.Context, before time.Time, limit int32) ([]DailyRow, error) {
					calls++
					if calls == 1 {
						return []DailyRow{{ID: pgUUID(dailyID), UserID: pgUUID(userID), Difficulty: "HARD"}}, nil
					}
					return nil, nil
				},
				getDamageAmount: func(ctx context.Context, difficulty string) (int32, error) { return 20, nil },
				markDailyMissed: func(ctx context.Context, id pgtype.UUID) error { return nil },
				insertOutbox: func(ctx context.Context, id pgtype.UUID, eventType string, payload []byte) error {
					var got events.DailyMissed
					if err := json.Unmarshal(payload, &got); err != nil {
						t.Fatalf("failed to unmarshal payload: %v", err)
					}
					if got.Version != 1 {
						t.Errorf("version = %d, want 1", got.Version)
					}
					if got.UserID != userID.String() {
						t.Errorf("user_id = %q, want %q", got.UserID, userID.String())
					}
					if got.DailyID != dailyID.String() {
						t.Errorf("daily_id = %q, want %q", got.DailyID, dailyID.String())
					}
					if got.DamageAmount != 20 {
						t.Errorf("damage_amount = %d, want 20", got.DamageAmount)
					}
					return nil
				},
				listPendingOutbox:   func(ctx context.Context, limit int32) ([]OutboxRow, error) { return nil, nil },
				markOutboxPublished: func(ctx context.Context, id int64) error { return nil },
			})
		},
	}
	publisher := &mockPublisher{}
	worker := NewWorker(store, publisher, WithClock(func() time.Time { return fixedNow }))

	if err := worker.Tick(context.Background()); err != nil {
		t.Fatalf("Tick returned error: %v", err)
	}
}
