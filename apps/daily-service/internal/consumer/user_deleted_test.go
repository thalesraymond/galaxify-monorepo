package consumer

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

func TestHandleUserDeleted(t *testing.T) {
	ctx := context.Background()

	t.Run("successfully deletes user cache on valid user.deleted event", func(t *testing.T) {
		tx := &fakeTx{}
		userID := uuid.New().String()
		expectedUUID, err := sharedhttp.ParseUUID(userID)
		if err != nil {
			t.Fatalf("failed to parse test uuid: %v", err)
		}

		env := events.Envelope{
			EventId:    uuid.New().String(),
			EventType:  "user.deleted",
			OccurredAt: time.Now().UTC(),
			Version:    1,
		}
		data := events.UserDeleted{
			Version: 1,
			UserID:  userID,
		}

		err = HandleUserDeleted(ctx, tx, env, data)
		if err != nil {
			t.Fatalf("expected nil error, got %v", err)
		}

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
	})

	t.Run("returns error when user_id is not a valid UUID", func(t *testing.T) {
		tx := &fakeTx{}
		env := events.Envelope{
			EventId:    uuid.New().String(),
			EventType:  "user.deleted",
			OccurredAt: time.Now().UTC(),
			Version:    1,
		}
		data := events.UserDeleted{
			Version: 1,
			UserID:  "invalid-uuid",
		}

		err := HandleUserDeleted(ctx, tx, env, data)
		if err == nil {
			t.Fatal("expected error on invalid user_id, got nil")
		}
		if len(tx.execCalls) != 0 {
			t.Fatalf("expected 0 exec calls on invalid UUID, got %d", len(tx.execCalls))
		}
	})

	t.Run("propagates database error", func(t *testing.T) {
		dbErr := errors.New("db error")
		tx := &fakeTx{execErr: dbErr}
		userID := uuid.New().String()

		env := events.Envelope{
			EventId:    uuid.New().String(),
			EventType:  "user.deleted",
			OccurredAt: time.Now().UTC(),
			Version:    1,
		}
		data := events.UserDeleted{
			Version: 1,
			UserID:  userID,
		}

		err := HandleUserDeleted(ctx, tx, env, data)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
		if !errors.Is(err, dbErr) {
			t.Fatalf("expected dbErr, got %v", err)
		}
	})
}
