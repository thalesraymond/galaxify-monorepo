package consumer_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/consumer"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

type fakeTx struct {
	pgx.Tx
	execCalls []execCall
	execErr   error
	tag       pgconn.CommandTag
}

type execCall struct {
	sql  string
	args []any
}

func (f *fakeTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.execCalls = append(f.execCalls, execCall{sql: sql, args: args})
	if f.execErr != nil {
		return pgconn.CommandTag{}, f.execErr
	}
	if f.tag.RowsAffected() != 0 || !f.tag.Insert() {
		return f.tag, nil
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func newTestConsumerEnvelope(eventType string) events.Envelope {
	return events.Envelope{
		EventId:    uuid.New().String(),
		EventType:  eventType,
		OccurredAt: time.Now().UTC(),
		Version:    1,
	}
}

func assertSingleExecShip(t *testing.T, tx *fakeTx, expectedUUID pgtype.UUID) {
	t.Helper()
	if len(tx.execCalls) != 1 {
		t.Fatalf("expected 1 exec call, got %d", len(tx.execCalls))
	}
	if len(tx.execCalls[0].args) != 4 {
		t.Fatalf("expected 4 args to exec call, got %d", len(tx.execCalls[0].args))
	}
	gotUUID, ok := tx.execCalls[0].args[0].(pgtype.UUID)
	if !ok {
		t.Fatalf("expected arg 0 to be pgtype.UUID, got %T", tx.execCalls[0].args[0])
	}
	if gotUUID != expectedUUID {
		t.Fatalf("expected UUID %v, got %v", expectedUUID, gotUUID)
	}
	gotHull, ok := tx.execCalls[0].args[1].(int32)
	if !ok || gotHull != 100 {
		t.Fatalf("expected hull_health 100, got %v (%T)", tx.execCalls[0].args[1], tx.execCalls[0].args[1])
	}
	gotMaterials, ok := tx.execCalls[0].args[2].(int32)
	if !ok || gotMaterials != 0 {
		t.Fatalf("expected materials_balance 0, got %v (%T)", tx.execCalls[0].args[2], tx.execCalls[0].args[2])
	}
	gotLevel, ok := tx.execCalls[0].args[3].(int32)
	if !ok || gotLevel != 1 {
		t.Fatalf("expected level 1, got %v (%T)", tx.execCalls[0].args[3], tx.execCalls[0].args[3])
	}
}

func TestHandleUserCreated(t *testing.T) {
	ctx := context.Background()

	t.Run("successfully inserts ship on valid user.created event with correct defaults", func(t *testing.T) {
		tx := &fakeTx{}
		userID := uuid.New().String()
		expectedUUID, err := sharedhttp.ParseUUID(userID)
		if err != nil {
			t.Fatalf("failed to parse test uuid: %v", err)
		}

		env := newTestConsumerEnvelope("user.created")
		data := events.UserCreated{
			Version:  1,
			UserID:   userID,
			Email:    "pilot@galaxify.io",
			Username: "pilot",
		}

		if err := consumer.HandleUserCreated(ctx, tx, env, data); err != nil {
			t.Fatalf("expected nil error, got %v", err)
		}

		assertSingleExecShip(t, tx, expectedUUID)
	})

	t.Run("returns error when user_id is not a valid UUID", func(t *testing.T) {
		tx := &fakeTx{}
		env := newTestConsumerEnvelope("user.created")
		data := events.UserCreated{
			Version:  1,
			UserID:   "invalid-uuid",
			Email:    "pilot@galaxify.io",
			Username: "pilot",
		}

		if err := consumer.HandleUserCreated(ctx, tx, env, data); err == nil {
			t.Fatal("expected error on invalid user_id, got nil")
		}
		if len(tx.execCalls) != 0 {
			t.Fatalf("expected 0 exec calls on invalid UUID, got %d", len(tx.execCalls))
		}
	})

	t.Run("propagates database error", func(t *testing.T) {
		dbErr := errors.New("db error")
		tx := &fakeTx{execErr: dbErr}
		env := newTestConsumerEnvelope("user.created")
		data := events.UserCreated{
			Version:  1,
			UserID:   uuid.New().String(),
			Email:    "pilot@galaxify.io",
			Username: "pilot",
		}

		err := consumer.HandleUserCreated(ctx, tx, env, data)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
		if !errors.Is(err, dbErr) {
			t.Fatalf("expected dbErr, got %v", err)
		}
	})

	t.Run("skips silently when ship already exists (defensive)", func(t *testing.T) {
		tx := &fakeTx{tag: pgconn.NewCommandTag("INSERT 0 0")}
		userID := uuid.New().String()
		expectedUUID, err := sharedhttp.ParseUUID(userID)
		if err != nil {
			t.Fatalf("failed to parse test uuid: %v", err)
		}

		env := newTestConsumerEnvelope("user.created")
		data := events.UserCreated{
			Version:  1,
			UserID:   userID,
			Email:    "pilot@galaxify.io",
			Username: "pilot",
		}

		if err := consumer.HandleUserCreated(ctx, tx, env, data); err != nil {
			t.Fatalf("expected nil error on conflict, got %v", err)
		}

		assertSingleExecShip(t, tx, expectedUUID)
	})
}

type fullFakeTx struct {
	pgx.Tx
	execCalls   []execCall
	execErr     error
	tag         pgconn.CommandTag
	committed   bool
	rolledBack  bool
	commitErr   error
	rollbackErr error
}

func (f *fullFakeTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.execCalls = append(f.execCalls, execCall{sql: sql, args: args})
	if f.execErr != nil {
		return pgconn.CommandTag{}, f.execErr
	}
	if f.tag.RowsAffected() != 0 || !f.tag.Insert() {
		return f.tag, nil
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (f *fullFakeTx) Commit(ctx context.Context) error {
	f.committed = true
	return f.commitErr
}

func (f *fullFakeTx) Rollback(ctx context.Context) error {
	if f.committed {
		return nil
	}
	f.rolledBack = true
	return f.rollbackErr
}

type fakeTxStarter struct {
	beginCalls int
	beginErr   error
	tx         *fullFakeTx
}

func (f *fakeTxStarter) Begin(ctx context.Context) (pgx.Tx, error) {
	f.beginCalls++
	if f.beginErr != nil {
		return nil, f.beginErr
	}
	return f.tx, nil
}

type fakeIdempotencyStore struct {
	rowsAffected int64
	insertErr    error
	insertedIDs  []pgtype.UUID
}

func (f *fakeIdempotencyStore) InsertProcessedEvent(ctx context.Context, eventID pgtype.UUID) (int64, error) {
	f.insertedIDs = append(f.insertedIDs, eventID)
	if f.insertErr != nil {
		return 0, f.insertErr
	}
	return f.rowsAffected, nil
}

func newRawEnvelopeBytes(t *testing.T, eventID, eventType string, payload any) []byte {
	t.Helper()
	var payloadBytes []byte
	switch p := payload.(type) {
	case []byte:
		payloadBytes = p
	default:
		var err error
		payloadBytes, err = json.Marshal(payload)
		if err != nil {
			t.Fatalf("failed to marshal inner payload: %v", err)
		}
	}

	env := events.Envelope{
		EventId:    eventID,
		EventType:  eventType,
		OccurredAt: time.Now().UTC(),
		Version:    1,
		Payload:    payloadBytes,
	}

	envBytes, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("failed to marshal envelope: %v", err)
	}
	return envBytes
}

func TestNewUserCreatedHandler(t *testing.T) {
	ctx := context.Background()

	t.Run("happy path: event arrives, ship row inserted with correct defaults, tx committed", func(t *testing.T) {
		tx := &fullFakeTx{}
		starter := &fakeTxStarter{tx: tx}
		store := &fakeIdempotencyStore{rowsAffected: 1}

		handler := consumer.NewUserCreatedHandler(
			starter,
			func(tx pgx.Tx) events.IdempotencyStore { return store },
		)

		eventID := uuid.New().String()
		userID := uuid.New().String()
		expectedUUID, err := sharedhttp.ParseUUID(userID)
		if err != nil {
			t.Fatalf("parse uuid: %v", err)
		}

		payload := newRawEnvelopeBytes(t, eventID, "user.created", events.UserCreated{
			Version:  1,
			UserID:   userID,
			Email:    "pilot@galaxify.io",
			Username: "pilot",
		})

		if err := handler(ctx, "user.created", payload); err != nil {
			t.Fatalf("expected nil error, got %v", err)
		}

		if !tx.committed {
			t.Fatal("expected transaction to be committed")
		}
		if tx.rolledBack {
			t.Fatal("expected transaction not to be rolled back")
		}
		if len(store.insertedIDs) != 1 {
			t.Fatalf("expected 1 processed event inserted, got %d", len(store.insertedIDs))
		}
		if len(tx.execCalls) != 1 {
			t.Fatalf("expected 1 exec call, got %d", len(tx.execCalls))
		}
		gotUUID, ok := tx.execCalls[0].args[0].(pgtype.UUID)
		if !ok || gotUUID != expectedUUID {
			t.Fatalf("expected UUID %v, got %v", expectedUUID, gotUUID)
		}
		if tx.execCalls[0].args[1] != int32(100) || tx.execCalls[0].args[2] != int32(0) || tx.execCalls[0].args[3] != int32(1) {
			t.Fatalf("expected default values (100, 0, 1), got %v", tx.execCalls[0].args)
		}
	})

	t.Run("idempotency: same event_id replayed, skips insert, rolls back tx, returns nil without error", func(t *testing.T) {
		tx := &fullFakeTx{}
		starter := &fakeTxStarter{tx: tx}
		store := &fakeIdempotencyStore{rowsAffected: 0} // Duplicate event

		handler := consumer.NewUserCreatedHandler(
			starter,
			func(tx pgx.Tx) events.IdempotencyStore { return store },
		)

		eventID := uuid.New().String()
		userID := uuid.New().String()
		payload := newRawEnvelopeBytes(t, eventID, "user.created", events.UserCreated{
			Version:  1,
			UserID:   userID,
			Email:    "pilot@galaxify.io",
			Username: "pilot",
		})

		if err := handler(ctx, "user.created", payload); err != nil {
			t.Fatalf("expected nil error (Ack), got %v", err)
		}

		if len(tx.execCalls) != 0 {
			t.Fatalf("expected 0 ship insert calls on duplicate, got %d", len(tx.execCalls))
		}
		if !tx.rolledBack {
			t.Fatal("expected transaction to be rolled back on duplicate")
		}
		if tx.committed {
			t.Fatal("expected transaction not to be committed on duplicate")
		}
	})

	t.Run("malformed payload: returns error and nacks message", func(t *testing.T) {
		tx := &fullFakeTx{}
		starter := &fakeTxStarter{tx: tx}
		store := &fakeIdempotencyStore{rowsAffected: 1}

		handler := consumer.NewUserCreatedHandler(
			starter,
			func(tx pgx.Tx) events.IdempotencyStore { return store },
		)

		t.Run("malformed envelope JSON", func(t *testing.T) {
			err := handler(ctx, "user.created", []byte("not-valid-json"))
			if err == nil {
				t.Fatal("expected error on malformed envelope JSON, got nil")
			}
			if starter.beginCalls != 0 {
				t.Fatalf("expected 0 Begin calls, got %d", starter.beginCalls)
			}
		})

		t.Run("invalid event_id UUID", func(t *testing.T) {
			payload := newRawEnvelopeBytes(t, "not-a-uuid", "user.created", events.UserCreated{
				Version: 1,
				UserID:  uuid.New().String(),
			})
			err := handler(ctx, "user.created", payload)
			if err == nil {
				t.Fatal("expected error on invalid event_id UUID, got nil")
			}
			if starter.beginCalls != 0 {
				t.Fatalf("expected 0 Begin calls, got %d", starter.beginCalls)
			}
		})

		t.Run("malformed inner payload JSON", func(t *testing.T) {
			payload := newRawEnvelopeBytes(t, uuid.New().String(), "user.created", []byte(`{"version": "invalid-int"}`))
			err := handler(ctx, "user.created", payload)
			if err == nil {
				t.Fatal("expected error on malformed inner payload, got nil")
			}
			if starter.beginCalls != 0 {
				t.Fatalf("expected 0 Begin calls, got %d", starter.beginCalls)
			}
		})

		t.Run("invalid user_id UUID in payload rolls back and returns error", func(t *testing.T) {
			tx := &fullFakeTx{}
			starter := &fakeTxStarter{tx: tx}
			store := &fakeIdempotencyStore{rowsAffected: 1}
			handler := consumer.NewUserCreatedHandler(
				starter,
				func(tx pgx.Tx) events.IdempotencyStore { return store },
			)

			payload := newRawEnvelopeBytes(t, uuid.New().String(), "user.created", events.UserCreated{
				Version: 1,
				UserID:  "not-a-uuid",
			})
			err := handler(ctx, "user.created", payload)
			if err == nil {
				t.Fatal("expected error on invalid user_id, got nil")
			}
			if !tx.rolledBack {
				t.Fatal("expected transaction to be rolled back on domain handler failure")
			}
			if tx.committed {
				t.Fatal("expected transaction not to be committed")
			}
		})
	})
}
