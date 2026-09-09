package consumer_test

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/consumer"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

func TestHandleExpeditionCompleted(t *testing.T) {
	tests := []struct {
		name             string
		outcome          string
		wantMutation     bool
		wantPublish      bool
		wantErrSubstring string
	}{
		{name: "success adds reward and publishes updated status", outcome: "SUCCESS", wantMutation: true, wantPublish: true},
		{name: "failure grants no reward", outcome: "FAILURE"},
		{name: "unknown outcome is rejected", outcome: "UNKNOWN", wantErrSubstring: "invalid outcome"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userID := uuid.New().String()
			parsedUserID, err := sharedhttp.ParseUUID(userID)
			if err != nil {
				t.Fatalf("parse user id: %v", err)
			}
			tx := &shipMutationTx{row: fakeRow{ship: fakeShipState{
				userID: parsedUserID, hullHealth: 79, materialsBalance: 34, level: 1,
			}}}
			publisher := &recordingPublisher{}

			err = consumer.HandleExpeditionCompleted(t.Context(), tx, newTestConsumerEnvelope("expedition.completed"), events.ExpeditionCompleted{
				Version: 1, UserID: userID, ExpeditionID: uuid.New().String(), Outcome: tt.outcome, MaterialsReward: 21,
			}, publisher)
			if tt.wantErrSubstring != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErrSubstring) {
					t.Fatalf("HandleExpeditionCompleted() error = %v, want containing %q", err, tt.wantErrSubstring)
				}
				return
			}
			if err != nil {
				t.Fatalf("HandleExpeditionCompleted() error = %v", err)
			}

			if tt.wantMutation {
				assertShipMutationCall(t, tx, parsedUserID, 21, "materials_balance = materials_balance + $2")
			} else if len(tx.queryCalls) != 0 {
				t.Fatalf("ship mutation calls = %d, want 0", len(tx.queryCalls))
			}
			if tt.wantPublish {
				assertPublishedShipStatus(t, publisher, userID, 79, 34)
			} else if len(publisher.calls) != 0 {
				t.Fatalf("publish calls = %d, want 0", len(publisher.calls))
			}
		})
	}
}

func TestNewExpeditionCompletedHandler(t *testing.T) {
	t.Run("commits successful reward", func(t *testing.T) {
		userID := uuid.New().String()
		parsedUserID, err := sharedhttp.ParseUUID(userID)
		if err != nil {
			t.Fatalf("parse user id: %v", err)
		}
		tx := &shipMutationTx{row: fakeRow{ship: fakeShipState{
			userID: parsedUserID, hullHealth: 84, materialsBalance: 46, level: 1,
		}}}
		store := &fakeIdempotencyStore{rowsAffected: 1}
		publisher := &recordingPublisher{}
		handler := consumer.NewExpeditionCompletedHandler(
			&fakeTxStarter{tx: tx},
			func(tx pgx.Tx) events.IdempotencyStore { return store },
			publisher,
		)

		err = handler(t.Context(), "expedition.completed", newRawEnvelopeBytes(t, uuid.New().String(), "expedition.completed", events.ExpeditionCompleted{
			Version: 1, UserID: userID, Outcome: "SUCCESS", MaterialsReward: 9,
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
		assertShipMutationCall(t, tx, parsedUserID, 9, "materials_balance = materials_balance + $2")
		assertPublishedShipStatus(t, publisher, userID, 84, 46)
	})

	t.Run("commits failure without reward", func(t *testing.T) {
		tx := &shipMutationTx{}
		publisher := &recordingPublisher{}
		handler := consumer.NewExpeditionCompletedHandler(
			&fakeTxStarter{tx: tx},
			func(tx pgx.Tx) events.IdempotencyStore { return &fakeIdempotencyStore{rowsAffected: 1} },
			publisher,
		)

		err := handler(t.Context(), "expedition.completed", newRawEnvelopeBytes(t, uuid.New().String(), "expedition.completed", events.ExpeditionCompleted{
			Version: 1, UserID: uuid.New().String(), Outcome: "FAILURE", MaterialsReward: 9,
		}))
		if err != nil {
			t.Fatalf("handler() error = %v", err)
		}
		if !tx.committed {
			t.Fatal("transaction was not committed")
		}
		if len(tx.queryCalls) != 0 || len(publisher.calls) != 0 {
			t.Fatal("failure outcome mutated or published ship state")
		}
	})
}

func TestNewExpeditionCompletedHandlerIdempotency(t *testing.T) {
	tx := &shipMutationTx{}
	publisher := &recordingPublisher{}
	handler := consumer.NewExpeditionCompletedHandler(
		&fakeTxStarter{tx: tx},
		func(tx pgx.Tx) events.IdempotencyStore { return &fakeIdempotencyStore{rowsAffected: 0} },
		publisher,
	)

	err := handler(t.Context(), "expedition.completed", newRawEnvelopeBytes(t, uuid.New().String(), "expedition.completed", events.ExpeditionCompleted{
		Version: 1, UserID: uuid.New().String(), Outcome: "SUCCESS", MaterialsReward: 5,
	}))
	if err != nil {
		t.Fatalf("duplicate handler call error = %v", err)
	}
	if len(tx.queryCalls) != 0 || len(publisher.calls) != 0 {
		t.Fatal("duplicate event mutated or published ship state")
	}
}
