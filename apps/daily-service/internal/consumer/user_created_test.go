package consumer

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

type fakeTx struct {
	pgx.Tx
	execCalls []execCall
	execErr   error
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

func assertSingleExecUUID(t *testing.T, tx *fakeTx, expectedUUID pgtype.UUID) {
	t.Helper()
	if len(tx.execCalls) != 1 {
		t.Fatalf("expected 1 exec call, got %d", len(tx.execCalls))
	}
	if len(tx.execCalls[0].args) != 1 {
		t.Fatalf("expected 1 arg to exec call, got %d", len(tx.execCalls[0].args))
	}
	gotUUID, ok := tx.execCalls[0].args[0].(pgtype.UUID)
	if !ok {
		t.Fatalf("expected arg to be pgtype.UUID, got %T", tx.execCalls[0].args[0])
	}
	if gotUUID != expectedUUID {
		t.Fatalf("expected UUID %v, got %v", expectedUUID, gotUUID)
	}
}

func TestHandleUserCreated(t *testing.T) {
	ctx := context.Background()

	t.Run("successfully upserts user cache on valid user.created event", func(t *testing.T) {
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

		if err := HandleUserCreated(ctx, tx, env, data); err != nil {
			t.Fatalf("expected nil error, got %v", err)
		}

		assertSingleExecUUID(t, tx, expectedUUID)
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

		if err := HandleUserCreated(ctx, tx, env, data); err == nil {
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

		err := HandleUserCreated(ctx, tx, env, data)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
		if !errors.Is(err, dbErr) {
			t.Fatalf("expected dbErr, got %v", err)
		}
	})
}
