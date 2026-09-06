package events

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type fakeTx struct {
	pgx.Tx
	committed   bool
	rolledBack  bool
	commitErr   error
	rollbackErr error
}

func (f *fakeTx) Commit(ctx context.Context) error {
	f.committed = true
	return f.commitErr
}

func (f *fakeTx) Rollback(ctx context.Context) error {
	f.rolledBack = true
	return f.rollbackErr
}

type fakeTxStarter struct {
	beginCalls int
	beginErr   error
	tx         *fakeTx
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

type testPayload struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

func TestIdempotentHandler_FastFailValidation(t *testing.T) {
	ctx := context.Background()

	t.Run("malformed envelope JSON returns error without opening transaction", func(t *testing.T) {
		txStarter := &fakeTxStarter{tx: &fakeTx{}}
		store := &fakeIdempotencyStore{rowsAffected: 1}
		handlerCalled := false

		handler := NewIdempotentHandler(
			txStarter,
			func(tx pgx.Tx) IdempotencyStore { return store },
			func(ctx context.Context, tx pgx.Tx, env Envelope, data testPayload) error {
				handlerCalled = true
				return nil
			},
		)

		err := handler(ctx, "test.event", []byte("invalid-json"))
		if err == nil {
			t.Fatal("expected error on malformed envelope JSON, got nil")
		}
		if txStarter.beginCalls != 0 {
			t.Fatalf("expected 0 Begin calls, got %d", txStarter.beginCalls)
		}
		if handlerCalled {
			t.Fatal("expected handler not to be called")
		}
	})

	t.Run("invalid UUID in event_id returns error without opening transaction", func(t *testing.T) {
		txStarter := &fakeTxStarter{tx: &fakeTx{}}
		store := &fakeIdempotencyStore{rowsAffected: 1}
		handlerCalled := false

		handler := NewIdempotentHandler(
			txStarter,
			func(tx pgx.Tx) IdempotencyStore { return store },
			func(ctx context.Context, tx pgx.Tx, env Envelope, data testPayload) error {
				handlerCalled = true
				return nil
			},
		)

		payloadBytes, _ := json.Marshal(testPayload{Name: "alice", Count: 1})
		env := Envelope{
			EventId:    "not-a-valid-uuid",
			EventType:  "test.event",
			OccurredAt: time.Now(),
			Version:    1,
			Payload:    payloadBytes,
		}
		envBytes, _ := json.Marshal(env)

		err := handler(ctx, "test.event", envBytes)
		if err == nil {
			t.Fatal("expected error on invalid UUID, got nil")
		}
		if txStarter.beginCalls != 0 {
			t.Fatalf("expected 0 Begin calls, got %d", txStarter.beginCalls)
		}
		if handlerCalled {
			t.Fatal("expected handler not to be called")
		}
	})

	t.Run("malformed inner payload JSON returns error without opening transaction", func(t *testing.T) {
		txStarter := &fakeTxStarter{tx: &fakeTx{}}
		store := &fakeIdempotencyStore{rowsAffected: 1}
		handlerCalled := false

		handler := NewIdempotentHandler(
			txStarter,
			func(tx pgx.Tx) IdempotencyStore { return store },
			func(ctx context.Context, tx pgx.Tx, env Envelope, data testPayload) error {
				handlerCalled = true
				return nil
			},
		)

		env := Envelope{
			EventId:    uuid.New().String(),
			EventType:  "test.event",
			OccurredAt: time.Now(),
			Version:    1,
			Payload:    json.RawMessage(`{"count": "not-an-int"}`),
		}
		envBytes, _ := json.Marshal(env)

		err := handler(ctx, "test.event", envBytes)
		if err == nil {
			t.Fatal("expected error on malformed inner payload JSON, got nil")
		}
		if txStarter.beginCalls != 0 {
			t.Fatalf("expected 0 Begin calls, got %d", txStarter.beginCalls)
		}
		if handlerCalled {
			t.Fatal("expected handler not to be called")
		}
	})
}

func TestIdempotentHandler_ExecutionLifecycle(t *testing.T) {
	ctx := context.Background()

	t.Run("first time event invokes handler, commits tx, and returns nil", func(t *testing.T) {
		tx := &fakeTx{}
		txStarter := &fakeTxStarter{tx: tx}
		store := &fakeIdempotencyStore{rowsAffected: 1}
		var receivedData testPayload
		var receivedEnv Envelope
		var receivedTx pgx.Tx

		handler := NewIdempotentHandler(
			txStarter,
			func(t pgx.Tx) IdempotencyStore { return store },
			func(ctx context.Context, tx pgx.Tx, env Envelope, data testPayload) error {
				receivedTx = tx
				receivedEnv = env
				receivedData = data
				return nil
			},
		)

		eventID := uuid.New().String()
		payloadBytes, _ := json.Marshal(testPayload{Name: "bob", Count: 42})
		env := Envelope{
			EventId:    eventID,
			EventType:  "test.event",
			OccurredAt: time.Now().UTC(),
			Version:    1,
			Payload:    payloadBytes,
		}
		envBytes, _ := json.Marshal(env)

		err := handler(ctx, "test.event", envBytes)
		if err != nil {
			t.Fatalf("expected nil error, got %v", err)
		}

		if txStarter.beginCalls != 1 {
			t.Fatalf("expected 1 Begin call, got %d", txStarter.beginCalls)
		}
		if len(store.insertedIDs) != 1 {
			t.Fatalf("expected 1 event inserted, got %d", len(store.insertedIDs))
		}
		if receivedTx != tx {
			t.Fatalf("expected handler to receive tx")
		}
		if receivedEnv.EventId != eventID {
			t.Fatalf("expected env.EventId %q, got %q", eventID, receivedEnv.EventId)
		}
		if receivedData.Name != "bob" || receivedData.Count != 42 {
			t.Fatalf("expected deserialized data bob/42, got %+v", receivedData)
		}
		if !tx.committed {
			t.Fatal("expected tx to be committed")
		}
	})

	t.Run("duplicate event skips handler, rolls back tx, and returns nil", func(t *testing.T) {
		tx := &fakeTx{}
		txStarter := &fakeTxStarter{tx: tx}
		store := &fakeIdempotencyStore{rowsAffected: 0}
		handlerCalled := false

		handler := NewIdempotentHandler(
			txStarter,
			func(t pgx.Tx) IdempotencyStore { return store },
			func(ctx context.Context, tx pgx.Tx, env Envelope, data testPayload) error {
				handlerCalled = true
				return nil
			},
		)

		eventID := uuid.New().String()
		payloadBytes, _ := json.Marshal(testPayload{Name: "charlie", Count: 3})
		env := Envelope{
			EventId:    eventID,
			EventType:  "test.event",
			OccurredAt: time.Now().UTC(),
			Version:    1,
			Payload:    payloadBytes,
		}
		envBytes, _ := json.Marshal(env)

		err := handler(ctx, "test.event", envBytes)
		if err != nil {
			t.Fatalf("expected nil error (Ack), got %v", err)
		}

		if handlerCalled {
			t.Fatal("expected handler NOT to be called for duplicate event")
		}
		if !tx.rolledBack {
			t.Fatal("expected tx to be rolled back")
		}
		if tx.committed {
			t.Fatal("expected tx NOT to be committed")
		}
	})

	t.Run("pool.Begin error returns error immediately", func(t *testing.T) {
		beginErr := errors.New("db connection down")
		txStarter := &fakeTxStarter{beginErr: beginErr}
		store := &fakeIdempotencyStore{rowsAffected: 1}

		handler := NewIdempotentHandler(
			txStarter,
			func(t pgx.Tx) IdempotencyStore { return store },
			func(ctx context.Context, tx pgx.Tx, env Envelope, data testPayload) error {
				return nil
			},
		)

		eventID := uuid.New().String()
		payloadBytes, _ := json.Marshal(testPayload{Name: "dave", Count: 1})
		env := Envelope{
			EventId:    eventID,
			EventType:  "test.event",
			OccurredAt: time.Now().UTC(),
			Version:    1,
			Payload:    payloadBytes,
		}
		envBytes, _ := json.Marshal(env)

		err := handler(ctx, "test.event", envBytes)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
		if !errors.Is(err, beginErr) {
			t.Fatalf("expected wrapped beginErr, got %v", err)
		}
	})

	t.Run("store.InsertProcessedEvent error rolls back and returns error", func(t *testing.T) {
		tx := &fakeTx{}
		txStarter := &fakeTxStarter{tx: tx}
		insertErr := errors.New("unique constraint query error")
		store := &fakeIdempotencyStore{insertErr: insertErr}
		handlerCalled := false

		handler := NewIdempotentHandler(
			txStarter,
			func(t pgx.Tx) IdempotencyStore { return store },
			func(ctx context.Context, tx pgx.Tx, env Envelope, data testPayload) error {
				handlerCalled = true
				return nil
			},
		)

		eventID := uuid.New().String()
		payloadBytes, _ := json.Marshal(testPayload{Name: "eve", Count: 1})
		env := Envelope{
			EventId:    eventID,
			EventType:  "test.event",
			OccurredAt: time.Now().UTC(),
			Version:    1,
			Payload:    payloadBytes,
		}
		envBytes, _ := json.Marshal(env)

		err := handler(ctx, "test.event", envBytes)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
		if !errors.Is(err, insertErr) {
			t.Fatalf("expected wrapped insertErr, got %v", err)
		}
		if handlerCalled {
			t.Fatal("expected handler NOT to be called")
		}
		if !tx.rolledBack {
			t.Fatal("expected tx to be rolled back")
		}
	})

	t.Run("handler error rolls back and returns error", func(t *testing.T) {
		tx := &fakeTx{}
		txStarter := &fakeTxStarter{tx: tx}
		store := &fakeIdempotencyStore{rowsAffected: 1}
		domainErr := errors.New("domain validation failed")

		handler := NewIdempotentHandler(
			txStarter,
			func(t pgx.Tx) IdempotencyStore { return store },
			func(ctx context.Context, tx pgx.Tx, env Envelope, data testPayload) error {
				return domainErr
			},
		)

		eventID := uuid.New().String()
		payloadBytes, _ := json.Marshal(testPayload{Name: "frank", Count: 1})
		env := Envelope{
			EventId:    eventID,
			EventType:  "test.event",
			OccurredAt: time.Now().UTC(),
			Version:    1,
			Payload:    payloadBytes,
		}
		envBytes, _ := json.Marshal(env)

		err := handler(ctx, "test.event", envBytes)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
		if !errors.Is(err, domainErr) {
			t.Fatalf("expected wrapped domainErr, got %v", err)
		}
		if !tx.rolledBack {
			t.Fatal("expected tx to be rolled back")
		}
		if tx.committed {
			t.Fatal("expected tx NOT to be committed")
		}
	})

	t.Run("commit error returns error", func(t *testing.T) {
		commitErr := errors.New("commit failed")
		tx := &fakeTx{commitErr: commitErr}
		txStarter := &fakeTxStarter{tx: tx}
		store := &fakeIdempotencyStore{rowsAffected: 1}

		handler := NewIdempotentHandler(
			txStarter,
			func(t pgx.Tx) IdempotencyStore { return store },
			func(ctx context.Context, tx pgx.Tx, env Envelope, data testPayload) error {
				return nil
			},
		)

		eventID := uuid.New().String()
		payloadBytes, _ := json.Marshal(testPayload{Name: "grace", Count: 1})
		env := Envelope{
			EventId:    eventID,
			EventType:  "test.event",
			OccurredAt: time.Now().UTC(),
			Version:    1,
			Payload:    payloadBytes,
		}
		envBytes, _ := json.Marshal(env)

		err := handler(ctx, "test.event", envBytes)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
		if !errors.Is(err, commitErr) {
			t.Fatalf("expected wrapped commitErr, got %v", err)
		}
		if !tx.committed {
			t.Fatal("expected Commit to have been called")
		}
	})

	t.Run("custom logger option records logs", func(t *testing.T) {
		var buf bytes.Buffer
		customLogger := slog.New(slog.NewTextHandler(&buf, nil))

		tx := &fakeTx{}
		txStarter := &fakeTxStarter{tx: tx}
		store := &fakeIdempotencyStore{rowsAffected: 1}

		handler := NewIdempotentHandler(
			txStarter,
			func(t pgx.Tx) IdempotencyStore { return store },
			func(ctx context.Context, tx pgx.Tx, env Envelope, data testPayload) error {
				return nil
			},
			WithConsumerLogger(customLogger),
		)

		eventID := uuid.New().String()
		payloadBytes, _ := json.Marshal(testPayload{Name: "heidi", Count: 1})
		env := Envelope{
			EventId:    eventID,
			EventType:  "test.event",
			OccurredAt: time.Now().UTC(),
			Version:    1,
			Payload:    payloadBytes,
		}
		envBytes, _ := json.Marshal(env)

		err := handler(ctx, "test.event", envBytes)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		logOutput := buf.String()
		if !bytes.Contains(buf.Bytes(), []byte("successfully processed event")) {
			t.Fatalf("expected custom logger to contain success log, got: %s", logOutput)
		}
	})
}
