package consumer_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/consumer"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

func TestHandleUserCreated(t *testing.T) {
	validUserID := uuid.New().String()
	parsedUserID, err := sharedhttp.ParseUUID(validUserID)
	if err != nil {
		t.Fatalf("parse user id: %v", err)
	}
	databaseErr := errors.New("database unavailable")

	tests := []struct {
		name         string
		data         events.UserCreated
		execErr      error
		wantErr      string
		wantCause    error
		wantExecCall bool
	}{
		{
			name: "seeds ship state cache with initial values",
			data: events.UserCreated{
				Version:  1,
				UserID:   validUserID,
				Email:    "pilot@galaxify.io",
				Username: "pilot",
			},
			wantExecCall: true,
		},
		{
			name: "rejects invalid user id",
			data: events.UserCreated{
				Version: 1, UserID: "invalid-user-id", Email: "pilot@galaxify.io", Username: "pilot",
			},
			wantErr: "invalid user_id",
		},
		{
			name: "wraps cache seed error",
			data: events.UserCreated{
				Version: 1, UserID: validUserID, Email: "pilot@galaxify.io", Username: "pilot",
			},
			execErr:      databaseErr,
			wantErr:      "seed ship cache",
			wantCause:    databaseErr,
			wantExecCall: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tx := &seedFakeTx{execErr: test.execErr}
			err := consumer.HandleUserCreated(t.Context(), tx, events.Envelope{}, test.data)
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("HandleUserCreated() error = %v, want containing %q", err, test.wantErr)
				}
				if test.wantCause != nil && !errors.Is(err, test.wantCause) {
					t.Fatalf("HandleUserCreated() error = %v, want to wrap %v", err, test.wantCause)
				}
			} else if err != nil {
				t.Fatalf("HandleUserCreated() error = %v", err)
			}

			if !test.wantExecCall {
				if len(tx.execCalls) != 0 {
					t.Fatalf("cache exec calls = %d, want 0", len(tx.execCalls))
				}
				return
			}
			assertShipCacheSeed(t, tx, parsedUserID, 100, 0)
		})
	}
}

func TestNewUserCreatedHandler(t *testing.T) {
	eventID := uuid.New()
	userID := uuid.New().String()
	tx := &seedFakeTx{}
	store := &fakeIdempotencyStore{rowsAffected: 1}
	handler := consumer.NewUserCreatedHandler(
		&seedTxStarter{tx: tx},
		func(tx pgx.Tx) events.IdempotencyStore { return store },
	)

	err := handler(t.Context(), "user.created", newUserCreatedEnvelopeBytes(t, eventID.String(), events.UserCreated{
		Version:  1,
		UserID:   userID,
		Email:    "pilot@galaxify.io",
		Username: "pilot",
	}))
	if err != nil {
		t.Fatalf("handler() error = %v", err)
	}
	if !tx.committed {
		t.Fatal("transaction was not committed")
	}
	if len(store.insertedIDs) != 1 {
		t.Fatalf("processed event inserts = %d, want 1", len(store.insertedIDs))
	}
	expectedEventID := pgtype.UUID{Bytes: eventID, Valid: true}
	if got := store.insertedIDs[0]; got != expectedEventID {
		t.Fatalf("processed event id = %v, want %v", got, expectedEventID)
	}

	parsedUserID, err := sharedhttp.ParseUUID(userID)
	if err != nil {
		t.Fatalf("parse user id: %v", err)
	}
	assertShipCacheSeed(t, tx, parsedUserID, 100, 0)
}

func TestNewUserCreatedHandler_FastFailValidation(t *testing.T) {
	tests := []struct {
		name    string
		payload []byte
	}{
		{
			name:    "malformed envelope JSON",
			payload: []byte("not-valid-json"),
		},
		{
			name: "invalid event id UUID",
			payload: newUserCreatedEnvelopeBytes(t, "not-a-uuid", events.UserCreated{
				Version: 1,
				UserID:  uuid.New().String(),
			}),
		},
		{
			name:    "malformed inner payload JSON",
			payload: newEnvelopeBytesWithPayload(t, uuid.New().String(), []byte(`{"version":"not-an-int"}`)),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			txStarter := &seedTxStarter{tx: &seedFakeTx{}}
			store := &fakeIdempotencyStore{rowsAffected: 1}
			handler := consumer.NewUserCreatedHandler(
				txStarter,
				func(tx pgx.Tx) events.IdempotencyStore { return store },
			)

			if err := handler(t.Context(), "user.created", test.payload); err == nil {
				t.Fatal("expected validation error, got nil")
			}
			if txStarter.beginCalls != 0 {
				t.Fatalf("transaction begin calls = %d, want 0", txStarter.beginCalls)
			}
		})
	}
}

func TestNewUserCreatedHandler_InvalidUserID(t *testing.T) {
	tx := &seedFakeTx{}
	store := &fakeIdempotencyStore{rowsAffected: 1}
	handler := consumer.NewUserCreatedHandler(
		&seedTxStarter{tx: tx},
		func(tx pgx.Tx) events.IdempotencyStore { return store },
	)

	err := handler(t.Context(), "user.created", newUserCreatedEnvelopeBytes(t, uuid.New().String(), events.UserCreated{
		Version: 1,
		UserID:  "not-a-uuid",
	}))
	if err == nil {
		t.Fatal("expected invalid user id error, got nil")
	}
	if !tx.rolledBack {
		t.Fatal("transaction was not rolled back")
	}
	if tx.committed {
		t.Fatal("transaction was committed")
	}
	if len(tx.execCalls) != 0 {
		t.Fatalf("cache exec calls = %d, want 0", len(tx.execCalls))
	}
}

func TestNewUserCreatedHandler_DuplicateEvent(t *testing.T) {
	tx := &seedFakeTx{}
	store := &fakeIdempotencyStore{rowsAffected: 0}
	handler := consumer.NewUserCreatedHandler(
		&seedTxStarter{tx: tx},
		func(tx pgx.Tx) events.IdempotencyStore { return store },
	)

	err := handler(t.Context(), "user.created", newUserCreatedEnvelopeBytes(t, uuid.New().String(), events.UserCreated{
		Version: 1,
		UserID:  uuid.New().String(),
	}))
	if err != nil {
		t.Fatalf("duplicate handler call error = %v", err)
	}
	if len(tx.execCalls) != 0 {
		t.Fatalf("cache exec calls = %d, want 0", len(tx.execCalls))
	}
	if !tx.rolledBack {
		t.Fatal("duplicate event transaction was not rolled back")
	}
}

func assertShipCacheSeed(t *testing.T, tx *seedFakeTx, expectedUserID pgtype.UUID, expectedHull, expectedMaterials int32) {
	t.Helper()
	if len(tx.execCalls) != 1 {
		t.Fatalf("cache exec calls = %d, want 1", len(tx.execCalls))
	}
	call := tx.execCalls[0]
	if !strings.Contains(call.sql, "INSERT INTO user_ship_state_cache") {
		t.Fatalf("cache query = %q, want insert", call.sql)
	}
	if !strings.Contains(call.sql, "ON CONFLICT (user_id) DO NOTHING") {
		t.Fatalf("cache query = %q, want conflict-safe seed", call.sql)
	}
	if len(call.args) != 3 {
		t.Fatalf("cache query args = %d, want 3", len(call.args))
	}
	if got := call.args[0]; got != expectedUserID {
		t.Fatalf("user id arg = %v, want %v", got, expectedUserID)
	}
	if got := call.args[1]; got != expectedHull {
		t.Fatalf("hull health arg = %v, want %v", got, expectedHull)
	}
	if got := call.args[2]; got != expectedMaterials {
		t.Fatalf("materials balance arg = %v, want %v", got, expectedMaterials)
	}
}

func newEnvelopeBytesWithPayload(t *testing.T, eventID string, payload []byte) []byte {
	t.Helper()
	envelopeBytes, err := json.Marshal(events.Envelope{
		EventId:    eventID,
		EventType:  "user.created",
		OccurredAt: time.Now().UTC(),
		Version:    1,
		Payload:    payload,
	})
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	return envelopeBytes
}

func newUserCreatedEnvelopeBytes(t *testing.T, eventID string, payload events.UserCreated) []byte {
	t.Helper()
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	envelopeBytes, err := json.Marshal(events.Envelope{
		EventId:    eventID,
		EventType:  "user.created",
		OccurredAt: time.Now().UTC(),
		Version:    1,
		Payload:    payloadBytes,
	})
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	return envelopeBytes
}

type seedFakeTx struct {
	pgx.Tx
	execCalls  []seedExecCall
	execErr    error
	committed  bool
	rolledBack bool
}

type seedExecCall struct {
	sql  string
	args []any
}

func (f *seedFakeTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.execCalls = append(f.execCalls, seedExecCall{sql: sql, args: args})
	if f.execErr != nil {
		return pgconn.CommandTag{}, f.execErr
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (f *seedFakeTx) Commit(ctx context.Context) error {
	f.committed = true
	return nil
}

func (f *seedFakeTx) Rollback(ctx context.Context) error {
	f.rolledBack = true
	return nil
}

type seedTxStarter struct {
	beginCalls int
	tx         pgx.Tx
}

func (s *seedTxStarter) Begin(ctx context.Context) (pgx.Tx, error) {
	s.beginCalls++
	return s.tx, nil
}
