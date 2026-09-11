package consumer_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/consumer"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

func TestHandleExpeditionLaunched(t *testing.T) {
	t.Run("deducts invested materials and stages updated status", func(t *testing.T) {
		userID := uuid.New().String()
		parsedUserID, err := sharedhttp.ParseUUID(userID)
		if err != nil {
			t.Fatalf("parse user id: %v", err)
		}
		tx := &shipMutationTx{row: fakeRow{ship: fakeShipState{
			userID:           parsedUserID,
			hullHealth:       88,
			materialsBalance: 27,
			level:            1,
		}}}

		err = consumer.HandleExpeditionLaunched(t.Context(), tx, newTestConsumerEnvelope("expedition.launched"), events.ExpeditionLaunched{
			Version:           1,
			UserID:            userID,
			ExpeditionID:      uuid.New().String(),
			MaterialsInvested: 13,
			SuccessChance:     0.65,
			ResolveAt:         "2026-09-10T12:00:00Z",
		})
		if err != nil {
			t.Fatalf("HandleExpeditionLaunched() error = %v", err)
		}

		if len(tx.queryCalls) != 1 {
			t.Fatalf("ship mutation calls = %d, want 1", len(tx.queryCalls))
		}
		if !strings.Contains(tx.queryCalls[0].sql, "materials_balance = materials_balance - $1") {
			t.Fatalf("ship mutation sql = %q, want material deduction", tx.queryCalls[0].sql)
		}
		if got := tx.queryCalls[0].args[0]; got != int32(13) {
			t.Fatalf("materials arg = %v, want 13", got)
		}
		if got := tx.queryCalls[0].args[1]; got != parsedUserID {
			t.Fatalf("user id arg = %v, want %v", got, parsedUserID)
		}
		assertStagedShipStatus(t, tx, userID, 88, 27)
	})

	t.Run("returns outbox insert error", func(t *testing.T) {
		outboxErr := errors.New("outbox insert failed")
		userID := uuid.New().String()
		parsedUserID, err := sharedhttp.ParseUUID(userID)
		if err != nil {
			t.Fatalf("parse user id: %v", err)
		}
		tx := &shipMutationTx{row: fakeRow{ship: fakeShipState{userID: parsedUserID}}}
		tx.execErr = outboxErr

		err = consumer.HandleExpeditionLaunched(t.Context(), tx, newTestConsumerEnvelope("expedition.launched"), events.ExpeditionLaunched{
			Version: 1, UserID: userID, MaterialsInvested: 5,
		})
		if !errors.Is(err, outboxErr) {
			t.Fatalf("HandleExpeditionLaunched() error = %v, want wrapped outbox error", err)
		}
	})
}

func TestNewExpeditionLaunchedHandler(t *testing.T) {
	userID := uuid.New().String()
	parsedUserID, err := sharedhttp.ParseUUID(userID)
	if err != nil {
		t.Fatalf("parse user id: %v", err)
	}
	tx := &shipMutationTx{row: fakeRow{ship: fakeShipState{
		userID: parsedUserID, hullHealth: 92, materialsBalance: 18, level: 1,
	}}}
	store := &fakeIdempotencyStore{rowsAffected: 1}
	handler := consumer.NewExpeditionLaunchedHandler(
		&fakeTxStarter{tx: tx},
		func(tx pgx.Tx) events.IdempotencyStore { return store },
	)

	err = handler(t.Context(), "expedition.launched", newRawEnvelopeBytes(t, uuid.New().String(), "expedition.launched", events.ExpeditionLaunched{
		Version: 1, UserID: userID, MaterialsInvested: 6,
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
	assertStagedShipStatus(t, tx, userID, 92, 18)
}

func TestNewExpeditionLaunchedHandlerIdempotency(t *testing.T) {
	tx := &shipMutationTx{}
	handler := consumer.NewExpeditionLaunchedHandler(
		&fakeTxStarter{tx: tx},
		func(tx pgx.Tx) events.IdempotencyStore { return &fakeIdempotencyStore{rowsAffected: 0} },
	)

	err := handler(t.Context(), "expedition.launched", newRawEnvelopeBytes(t, uuid.New().String(), "expedition.launched", events.ExpeditionLaunched{
		Version: 1, UserID: uuid.New().String(), MaterialsInvested: 5,
	}))
	if err != nil {
		t.Fatalf("duplicate handler call error = %v", err)
	}
	if len(tx.queryCalls) != 0 {
		t.Fatalf("ship mutation calls = %d, want 0", len(tx.queryCalls))
	}
	if len(tx.execCalls) != 0 {
		t.Fatalf("outbox insert calls = %d, want 0", len(tx.execCalls))
	}
}
