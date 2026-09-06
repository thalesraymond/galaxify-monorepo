package consumer

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

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

		env := newTestConsumerEnvelope("user.deleted")
		data := events.UserDeleted{
			Version: 1,
			UserID:  userID,
		}

		if err := HandleUserDeleted(ctx, tx, env, data); err != nil {
			t.Fatalf("expected nil error, got %v", err)
		}

		assertSingleExecUUID(t, tx, expectedUUID)
	})

	t.Run("returns error when user_id is not a valid UUID", func(t *testing.T) {
		tx := &fakeTx{}
		env := newTestConsumerEnvelope("user.deleted")
		data := events.UserDeleted{
			Version: 1,
			UserID:  "invalid-uuid",
		}

		if err := HandleUserDeleted(ctx, tx, env, data); err == nil {
			t.Fatal("expected error on invalid user_id, got nil")
		}
		if len(tx.execCalls) != 0 {
			t.Fatalf("expected 0 exec calls on invalid UUID, got %d", len(tx.execCalls))
		}
	})

	t.Run("propagates database error", func(t *testing.T) {
		dbErr := errors.New("db error")
		tx := &fakeTx{execErr: dbErr}
		env := newTestConsumerEnvelope("user.deleted")
		data := events.UserDeleted{
			Version: 1,
			UserID:  uuid.New().String(),
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
