package consumer_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/consumer"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

func TestHandleDailyMissed(t *testing.T) {
	tests := []struct {
		name         string
		initialHull  int32
		damageAmount int
		expectedHull int
		materials    int32
	}{
		{
			name:         "applies damage and publishes updated status",
			initialHull:  72,
			damageAmount: 13,
			expectedHull: 72,
			materials:    9,
		},
		{
			name:         "hull at zero remains zero after more damage",
			initialHull:  0,
			damageAmount: 25,
			expectedHull: 0,
			materials:    9,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userID := uuid.New().String()
			parsedUserID, err := sharedhttp.ParseUUID(userID)
			if err != nil {
				t.Fatalf("parse user id: %v", err)
			}
			tx := &shipMutationTx{row: fakeRow{ship: fakeShipState{
				userID:           parsedUserID,
				hullHealth:       tt.initialHull,
				materialsBalance: tt.materials,
				level:            1,
			}}}

			err = consumer.HandleDailyMissed(t.Context(), tx, newTestConsumerEnvelope("daily.missed"), events.DailyMissed{
				Version:      1,
				UserID:       userID,
				DailyID:      uuid.New().String(),
				DamageAmount: tt.damageAmount,
			})
			if err != nil {
				t.Fatalf("HandleDailyMissed() error = %v", err)
			}

			assertShipMutationCall(t, tx, parsedUserID, int32(tt.damageAmount), "GREATEST(0, hull_health - $2)")
			assertStagedShipStatus(t, tx, userID, tt.expectedHull, int(tt.materials))
		})
	}
}

func TestNewDailyMissedHandler(t *testing.T) {
	userID := uuid.New().String()
	parsedUserID, err := sharedhttp.ParseUUID(userID)
	if err != nil {
		t.Fatalf("parse user id: %v", err)
	}
	tx := &shipMutationTx{row: fakeRow{ship: fakeShipState{
		userID:           parsedUserID,
		hullHealth:       76,
		materialsBalance: 8,
		level:            1,
	}}}
	starter := &fakeTxStarter{tx: tx}
	store := &fakeIdempotencyStore{rowsAffected: 1}
	handler := consumer.NewDailyMissedHandler(
		starter,
		func(tx pgx.Tx) events.IdempotencyStore { return store },
	)

	err = handler(t.Context(), "daily.missed", newRawEnvelopeBytes(t, uuid.New().String(), "daily.missed", events.DailyMissed{
		Version: 1, UserID: userID, DamageAmount: 6,
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
	assertShipMutationCall(t, tx, parsedUserID, 6, "GREATEST(0, hull_health - $2)")
	assertStagedShipStatus(t, tx, userID, 76, 8)
}

func TestNewDailyMissedHandlerIdempotency(t *testing.T) {
	tx := &shipMutationTx{}
	starter := &fakeTxStarter{tx: tx}
	store := &fakeIdempotencyStore{rowsAffected: 0}
	handler := consumer.NewDailyMissedHandler(
		starter,
		func(tx pgx.Tx) events.IdempotencyStore { return store },
	)

	err := handler(t.Context(), "daily.missed", newRawEnvelopeBytes(t, uuid.New().String(), "daily.missed", events.DailyMissed{
		Version: 1, UserID: uuid.New().String(), DamageAmount: 5,
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
