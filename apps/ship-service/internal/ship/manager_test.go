package ship

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
)

type mockStore struct {
	getByUser    func(context.Context, pgtype.UUID) (database.Ship, error)
	repair       func(context.Context, database.RepairParams) (database.Ship, error)
	insertOutbox func(context.Context, database.InsertOutboxParams) error
}

func (m *mockStore) GetByUser(ctx context.Context, userID pgtype.UUID) (database.Ship, error) {
	return m.getByUser(ctx, userID)
}

func (m *mockStore) Repair(ctx context.Context, params database.RepairParams) (database.Ship, error) {
	return m.repair(ctx, params)
}

func (m *mockStore) InsertOutbox(ctx context.Context, arg database.InsertOutboxParams) error {
	return m.insertOutbox(ctx, arg)
}

type fakeTx struct {
	pgx.Tx
	committed  bool
	rolledBack bool
}

func (f *fakeTx) Commit(context.Context) error   { f.committed = true; return nil }
func (f *fakeTx) Rollback(context.Context) error { f.rolledBack = true; return nil }

type fakeTxStarter struct{ tx *fakeTx }

func (s *fakeTxStarter) Begin(context.Context) (pgx.Tx, error) {
	if s.tx == nil {
		s.tx = &fakeTx{}
	}
	return s.tx, nil
}

func TestManagerRepair(t *testing.T) {
	userID := uuid.New()
	tests := []struct {
		name             string
		current          database.Ship
		getErr           error
		repairErr        error
		outboxErr        error
		roll             repairRoll
		wantErr          error
		wantMaterialsUse int32
		wantHullRestore  int32
		wantState        State
	}{
		{
			name:             "partially repairs with one roll per material",
			current:          testShip(userID, 80, 2),
			roll:             sequenceRoll(3, -2),
			wantMaterialsUse: 2,
			wantHullRestore:  11,
			wantState:        State{UserID: userID, HullHealth: 91, MaterialsBalance: 0, Level: 2, UpdatedAt: testTime},
		},
		{
			name:             "fully repairs and clamps restored hull",
			current:          testShip(userID, 95, 10),
			roll:             func() int { return 3 },
			wantMaterialsUse: 5,
			wantHullRestore:  5,
			wantState:        State{UserID: userID, HullHealth: 100, MaterialsBalance: 5, Level: 2, UpdatedAt: testTime},
		},
		{name: "does not repair a missing ship", getErr: pgx.ErrNoRows, wantErr: ErrNotFound},
		{name: "does not repair a full hull", current: testShip(userID, 100, 2), wantErr: ErrHullFull},
		{name: "does not repair without materials", current: testShip(userID, 80, 0), wantErr: ErrInsufficientMaterials},
		{name: "wraps store errors", getErr: errors.New("database unavailable")},
		{name: "wraps repair errors", current: testShip(userID, 80, 2), repairErr: errors.New("update failed"), roll: func() int { return 0 }},
		{name: "wraps outbox errors", current: testShip(userID, 80, 2), outboxErr: errors.New("outbox insert failed"), roll: func() int { return 0 }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var gotParams database.RepairParams
			var outbox *database.InsertOutboxParams
			store := &mockStore{
				getByUser: func(_ context.Context, gotUserID pgtype.UUID) (database.Ship, error) {
					if gotUserID.Bytes != userID {
						t.Errorf("get user_id = %s, want %s", gotUserID.Bytes, userID)
					}
					return test.current, test.getErr
				},
				repair: func(_ context.Context, params database.RepairParams) (database.Ship, error) {
					gotParams = params
					if test.repairErr != nil {
						return database.Ship{}, test.repairErr
					}
					updated := test.current
					updated.HullHealth += params.HullHealth
					updated.MaterialsBalance -= params.MaterialsBalance
					return updated, nil
				},
				insertOutbox: func(_ context.Context, arg database.InsertOutboxParams) error {
					outbox = &arg
					return test.outboxErr
				},
			}
			starter := &fakeTxStarter{}
			manager := newManager(store, starter, func(tx pgx.Tx) Store { return store }, test.roll)

			state, err := manager.Repair(context.Background(), userID)

			if test.wantErr != nil {
				if !errors.Is(err, test.wantErr) {
					t.Fatalf("error = %v, want %v", err, test.wantErr)
				}
				return
			}
			if (test.getErr != nil || test.repairErr != nil || test.outboxErr != nil) && err == nil {
				t.Fatal("expected an error")
			}
			if err != nil {
				return
			}
			if gotParams.MaterialsBalance != test.wantMaterialsUse || gotParams.HullHealth != test.wantHullRestore {
				t.Errorf("repair params = %+v, want materials=%d hull=%d", gotParams, test.wantMaterialsUse, test.wantHullRestore)
			}
			if state != test.wantState {
				t.Errorf("state = %+v, want %+v", state, test.wantState)
			}
			if !starter.tx.committed {
				t.Error("repair transaction was not committed")
			}
			if outbox == nil {
				t.Fatal("outbox event was not staged")
			}
			if outbox.EventType != statusUpdatedEventType {
				t.Errorf("event type = %q, want %q", outbox.EventType, statusUpdatedEventType)
			}
			var payload events.ShipStatusUpdated
			if err := json.Unmarshal(outbox.Payload, &payload); err != nil {
				t.Fatalf("decode outbox payload: %v", err)
			}
			wantPayload := events.ShipStatusUpdated{Version: 1, UserID: userID.String(), HullHealth: int(state.HullHealth), MaterialsBalance: int(state.MaterialsBalance)}
			if payload != wantPayload {
				t.Errorf("event payload = %#v, want %#v", payload, wantPayload)
			}
		})
	}
}

func TestManagerGet(t *testing.T) {
	userID := uuid.New()
	wantShip := testShip(userID, 85, 10)
	wantState := State{
		UserID:           userID,
		HullHealth:       85,
		MaterialsBalance: 10,
		Level:            2,
		UpdatedAt:        testTime,
	}

	tests := []struct {
		name      string
		current   database.Ship
		getErr    error
		wantErr   error
		wantState State
	}{
		{
			name:      "returns ship state when found",
			current:   wantShip,
			wantState: wantState,
		},
		{
			name:    "returns ErrNotFound when ship does not exist",
			getErr:  pgx.ErrNoRows,
			wantErr: ErrNotFound,
		},
		{
			name:   "wraps store errors",
			getErr: errors.New("database unavailable"),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &mockStore{
				getByUser: func(_ context.Context, gotUserID pgtype.UUID) (database.Ship, error) {
					if gotUserID.Bytes != userID {
						t.Errorf("get user_id = %s, want %s", gotUserID.Bytes, userID)
					}
					return test.current, test.getErr
				},
			}
			manager := newManager(store, &fakeTxStarter{}, func(tx pgx.Tx) Store { return store }, nil)

			state, err := manager.Get(context.Background(), userID)

			if test.wantErr != nil {
				if !errors.Is(err, test.wantErr) {
					t.Fatalf("error = %v, want %v", err, test.wantErr)
				}
				return
			}
			if test.getErr != nil && err == nil {
				t.Fatal("expected an error")
			}
			if err != nil {
				return
			}
			if state != test.wantState {
				t.Errorf("state = %+v, want %+v", state, test.wantState)
			}
		})
	}
}

var testTime = time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)

func testShip(userID uuid.UUID, hullHealth, materialsBalance int32) database.Ship {
	return database.Ship{UserID: pgtype.UUID{Bytes: userID, Valid: true}, HullHealth: hullHealth, MaterialsBalance: materialsBalance, Level: 2, UpdatedAt: pgtype.Timestamptz{Time: testTime, Valid: true}}
}

func sequenceRoll(values ...int) repairRoll {
	index := 0
	return func() int {
		value := values[index]
		index++
		return value
	}
}
