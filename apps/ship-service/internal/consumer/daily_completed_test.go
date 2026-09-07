package consumer_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/consumer"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

type fakeRow struct {
	ship    fakeShipState
	scanErr error
}

type fakeShipState struct {
	userID           pgtype.UUID
	hullHealth       int32
	materialsBalance int32
	level            int32
	updatedAt        pgtype.Timestamptz
}

func (r fakeRow) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	*(dest[0].(*pgtype.UUID)) = r.ship.userID
	*(dest[1].(*int32)) = r.ship.hullHealth
	*(dest[2].(*int32)) = r.ship.materialsBalance
	*(dest[3].(*int32)) = r.ship.level
	*(dest[4].(*pgtype.Timestamptz)) = r.ship.updatedAt
	return nil
}

type shipMutationTx struct {
	fullFakeTx
	queryCalls []execCall
	row        fakeRow
}

func (f *shipMutationTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	f.queryCalls = append(f.queryCalls, execCall{sql: sql, args: args})
	return f.row
}

type publishCall struct {
	eventType string
	payload   any
}

type recordingPublisher struct {
	calls []publishCall
	err   error
}

func (p *recordingPublisher) Publish(ctx context.Context, eventType string, payload any) error {
	p.calls = append(p.calls, publishCall{eventType: eventType, payload: payload})
	return p.err
}

func TestHandleDailyCompleted(t *testing.T) {
	t.Run("adds reward to existing materials and publishes updated status", func(t *testing.T) {
		userID := uuid.New().String()
		parsedUserID, err := sharedhttp.ParseUUID(userID)
		if err != nil {
			t.Fatalf("parse user id: %v", err)
		}
		tx := &shipMutationTx{row: fakeRow{ship: fakeShipState{
			userID:           parsedUserID,
			hullHealth:       83,
			materialsBalance: 17,
			level:            1,
		}}}
		publisher := &recordingPublisher{}

		err = consumer.HandleDailyCompleted(t.Context(), tx, newTestConsumerEnvelope("daily.completed"), events.DailyCompleted{
			Version:         1,
			UserID:          userID,
			DailyID:         uuid.New().String(),
			Difficulty:      "MEDIUM",
			RewardMaterials: 7,
		}, publisher)
		if err != nil {
			t.Fatalf("HandleDailyCompleted() error = %v", err)
		}

		assertShipMutationCall(t, tx, parsedUserID, 7, "materials_balance = materials_balance + $2")
		assertPublishedShipStatus(t, publisher, userID, 83, 17)
	})

	t.Run("returns publisher error", func(t *testing.T) {
		publishErr := errors.New("publish failed")
		userID := uuid.New().String()
		parsedUserID, err := sharedhttp.ParseUUID(userID)
		if err != nil {
			t.Fatalf("parse user id: %v", err)
		}
		tx := &shipMutationTx{row: fakeRow{ship: fakeShipState{userID: parsedUserID}}}
		publisher := &recordingPublisher{err: publishErr}

		err = consumer.HandleDailyCompleted(t.Context(), tx, newTestConsumerEnvelope("daily.completed"), events.DailyCompleted{
			Version: 1, UserID: userID, RewardMaterials: 5,
		}, publisher)
		if !errors.Is(err, publishErr) {
			t.Fatalf("HandleDailyCompleted() error = %v, want wrapped publisher error", err)
		}
	})
}

func TestNewDailyCompletedHandler(t *testing.T) {
	userID := uuid.New().String()
	parsedUserID, err := sharedhttp.ParseUUID(userID)
	if err != nil {
		t.Fatalf("parse user id: %v", err)
	}
	tx := &shipMutationTx{row: fakeRow{ship: fakeShipState{
		userID:           parsedUserID,
		hullHealth:       91,
		materialsBalance: 14,
		level:            1,
	}}}
	starter := &fakeTxStarter{tx: tx}
	store := &fakeIdempotencyStore{rowsAffected: 1}
	publisher := &recordingPublisher{}
	handler := consumer.NewDailyCompletedHandler(
		starter,
		func(tx pgx.Tx) events.IdempotencyStore { return store },
		publisher,
	)
	eventID := uuid.New().String()

	err = handler(t.Context(), "daily.completed", newRawEnvelopeBytes(t, eventID, "daily.completed", events.DailyCompleted{
		Version: 1, UserID: userID, RewardMaterials: 4,
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
	expectedEventID, err := sharedhttp.ParseUUID(eventID)
	if err != nil {
		t.Fatalf("parse event id: %v", err)
	}
	if store.insertedIDs[0] != expectedEventID {
		t.Fatalf("processed event id = %v, want %v", store.insertedIDs[0], expectedEventID)
	}
	assertShipMutationCall(t, tx, parsedUserID, 4, "materials_balance = materials_balance + $2")
	assertPublishedShipStatus(t, publisher, userID, 91, 14)
}

func TestNewDailyCompletedHandlerIdempotency(t *testing.T) {
	tx := &shipMutationTx{}
	starter := &fakeTxStarter{tx: tx}
	store := &fakeIdempotencyStore{rowsAffected: 0}
	publisher := &recordingPublisher{}
	handler := consumer.NewDailyCompletedHandler(
		starter,
		func(tx pgx.Tx) events.IdempotencyStore { return store },
		publisher,
	)
	eventID := uuid.New().String()

	err := handler(t.Context(), "daily.completed", newRawEnvelopeBytes(t, eventID, "daily.completed", events.DailyCompleted{
		Version: 1, UserID: uuid.New().String(), RewardMaterials: 5,
	}))
	if err != nil {
		t.Fatalf("duplicate handler call error = %v", err)
	}
	if len(tx.queryCalls) != 0 {
		t.Fatalf("ship mutation calls = %d, want 0", len(tx.queryCalls))
	}
	if len(publisher.calls) != 0 {
		t.Fatalf("publish calls = %d, want 0", len(publisher.calls))
	}
}

func assertShipMutationCall(t *testing.T, tx *shipMutationTx, expectedUserID pgtype.UUID, expectedAmount int32, expectedSQLFragment string) {
	t.Helper()
	if len(tx.queryCalls) != 1 {
		t.Fatalf("ship mutation calls = %d, want 1", len(tx.queryCalls))
	}
	if !strings.Contains(tx.queryCalls[0].sql, expectedSQLFragment) {
		t.Fatalf("ship mutation sql = %q, want fragment %q", tx.queryCalls[0].sql, expectedSQLFragment)
	}
	if len(tx.queryCalls[0].args) != 2 {
		t.Fatalf("ship mutation args = %d, want 2", len(tx.queryCalls[0].args))
	}
	if got := tx.queryCalls[0].args[0]; got != expectedUserID {
		t.Fatalf("user id arg = %v, want %v", got, expectedUserID)
	}
	if got := tx.queryCalls[0].args[1]; got != expectedAmount {
		t.Fatalf("amount arg = %v, want %v", got, expectedAmount)
	}
}

func assertPublishedShipStatus(t *testing.T, publisher *recordingPublisher, expectedUserID string, expectedHull, expectedMaterials int) {
	t.Helper()
	if len(publisher.calls) != 1 {
		t.Fatalf("publish calls = %d, want 1", len(publisher.calls))
	}
	call := publisher.calls[0]
	if call.eventType != "ship.status_updated" {
		t.Fatalf("event type = %q, want ship.status_updated", call.eventType)
	}
	payload, ok := call.payload.(events.ShipStatusUpdated)
	if !ok {
		t.Fatalf("payload type = %T, want events.ShipStatusUpdated", call.payload)
	}
	expected := events.ShipStatusUpdated{
		Version:          1,
		UserID:           expectedUserID,
		HullHealth:       expectedHull,
		MaterialsBalance: expectedMaterials,
	}
	if payload != expected {
		t.Fatalf("payload = %+v, want %+v", payload, expected)
	}
}
