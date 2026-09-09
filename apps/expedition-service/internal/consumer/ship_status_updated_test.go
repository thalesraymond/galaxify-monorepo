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
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/consumer"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

type fakeTx struct {
	pgx.Tx
	queryCalls []queryCall
	row        fakeRow
	committed  bool
	rolledBack bool
}

type queryCall struct {
	sql  string
	args []any
}

type fakeRow struct {
	scanErr error
}

func (f *fakeTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	f.queryCalls = append(f.queryCalls, queryCall{sql: sql, args: args})
	return f.row
}

func (f *fakeTx) Commit(ctx context.Context) error {
	f.committed = true
	return nil
}

func (f *fakeTx) Rollback(ctx context.Context) error {
	f.rolledBack = true
	return nil
}

func (r fakeRow) Scan(dest ...any) error {
	return r.scanErr
}

type fakeTxStarter struct {
	tx pgx.Tx
}

func (f fakeTxStarter) Begin(ctx context.Context) (pgx.Tx, error) {
	return f.tx, nil
}

type fakeIdempotencyStore struct {
	rowsAffected int64
	insertedIDs  []pgtype.UUID
}

func (f *fakeIdempotencyStore) InsertProcessedEvent(ctx context.Context, eventID pgtype.UUID) (int64, error) {
	f.insertedIDs = append(f.insertedIDs, eventID)
	return f.rowsAffected, nil
}

func TestHandleShipStatusUpdated(t *testing.T) {
	validUserID := uuid.New().String()
	parsedUserID, err := sharedhttp.ParseUUID(validUserID)
	if err != nil {
		t.Fatalf("parse user id: %v", err)
	}

	tests := []struct {
		name          string
		data          events.ShipStatusUpdated
		row           fakeRow
		wantErr       string
		wantQueryCall bool
	}{
		{
			name: "upserts ship state cache",
			data: events.ShipStatusUpdated{
				Version:          1,
				UserID:           validUserID,
				HullHealth:       78,
				MaterialsBalance: 42,
			},
			wantQueryCall: true,
		},
		{
			name: "rejects invalid user id",
			data: events.ShipStatusUpdated{
				Version: 1, UserID: "invalid-user-id", HullHealth: 78, MaterialsBalance: 42,
			},
			wantErr: "invalid user_id",
		},
		{
			name: "rejects hull health below range",
			data: events.ShipStatusUpdated{
				Version: 1, UserID: validUserID, HullHealth: -1, MaterialsBalance: 42,
			},
			wantErr: "invalid hull_health",
		},
		{
			name: "rejects negative materials balance",
			data: events.ShipStatusUpdated{
				Version: 1, UserID: validUserID, HullHealth: 78, MaterialsBalance: -1,
			},
			wantErr: "invalid materials_balance",
		},
		{
			name: "wraps cache query error",
			data: events.ShipStatusUpdated{
				Version: 1, UserID: validUserID, HullHealth: 78, MaterialsBalance: 42,
			},
			row:           fakeRow{scanErr: errors.New("database unavailable")},
			wantErr:       "upsert ship cache",
			wantQueryCall: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tx := &fakeTx{row: test.row}
			err := consumer.HandleShipStatusUpdated(t.Context(), tx, events.Envelope{}, test.data)
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("HandleShipStatusUpdated() error = %v, want containing %q", err, test.wantErr)
				}
			} else if err != nil {
				t.Fatalf("HandleShipStatusUpdated() error = %v", err)
			}

			if !test.wantQueryCall {
				if len(tx.queryCalls) != 0 {
					t.Fatalf("cache query calls = %d, want 0", len(tx.queryCalls))
				}
				return
			}
			assertShipCacheUpsert(t, tx, parsedUserID, 78, 42)
		})
	}
}

func TestNewShipStatusUpdatedHandler(t *testing.T) {
	userID := uuid.New().String()
	parsedEventID := uuid.New()
	tx := &fakeTx{}
	store := &fakeIdempotencyStore{rowsAffected: 1}
	handler := consumer.NewShipStatusUpdatedHandler(
		fakeTxStarter{tx: tx},
		func(tx pgx.Tx) events.IdempotencyStore { return store },
	)

	err := handler(t.Context(), "ship.status_updated", newRawEnvelopeBytes(t, parsedEventID.String(), events.ShipStatusUpdated{
		Version: 1, UserID: userID, HullHealth: 65, MaterialsBalance: 25,
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
	expectedEventID := pgtype.UUID{Bytes: parsedEventID, Valid: true}
	if got := store.insertedIDs[0]; got != expectedEventID {
		t.Fatalf("processed event id = %v, want %v", got, expectedEventID)
	}

	parsedUserID, err := sharedhttp.ParseUUID(userID)
	if err != nil {
		t.Fatalf("parse user id: %v", err)
	}
	assertShipCacheUpsert(t, tx, parsedUserID, 65, 25)
}

func TestNewShipStatusUpdatedHandler_DuplicateEvent(t *testing.T) {
	tx := &fakeTx{}
	store := &fakeIdempotencyStore{rowsAffected: 0}
	handler := consumer.NewShipStatusUpdatedHandler(
		fakeTxStarter{tx: tx},
		func(tx pgx.Tx) events.IdempotencyStore { return store },
	)

	err := handler(t.Context(), "ship.status_updated", newRawEnvelopeBytes(t, uuid.New().String(), events.ShipStatusUpdated{
		Version: 1, UserID: uuid.New().String(), HullHealth: 65, MaterialsBalance: 25,
	}))
	if err != nil {
		t.Fatalf("duplicate handler call error = %v", err)
	}
	if len(tx.queryCalls) != 0 {
		t.Fatalf("cache query calls = %d, want 0", len(tx.queryCalls))
	}
	if !tx.rolledBack {
		t.Fatal("duplicate event transaction was not rolled back")
	}
}

func assertShipCacheUpsert(t *testing.T, tx *fakeTx, expectedUserID pgtype.UUID, expectedHull, expectedMaterials int32) {
	t.Helper()
	if len(tx.queryCalls) != 1 {
		t.Fatalf("cache query calls = %d, want 1", len(tx.queryCalls))
	}
	call := tx.queryCalls[0]
	if !strings.Contains(call.sql, "INSERT INTO user_ship_state_cache") {
		t.Fatalf("cache query = %q, want upsert", call.sql)
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

func newRawEnvelopeBytes(t *testing.T, eventID string, payload events.ShipStatusUpdated) []byte {
	t.Helper()
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	envelopeBytes, err := json.Marshal(events.Envelope{
		EventId:    eventID,
		EventType:  "ship.status_updated",
		OccurredAt: time.Now().UTC(),
		Version:    1,
		Payload:    payloadBytes,
	})
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	return envelopeBytes
}
