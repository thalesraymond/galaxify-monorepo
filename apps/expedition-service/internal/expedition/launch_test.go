package expedition

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
)

type launchFakeTx struct {
	pgx.Tx
	committed bool
}

func (tx *launchFakeTx) Commit(context.Context) error {
	tx.committed = true
	return nil
}

func (tx *launchFakeTx) Rollback(context.Context) error { return nil }

type launchTxStarter struct {
	tx  pgx.Tx
	err error
}

func (s launchTxStarter) Begin(context.Context) (pgx.Tx, error) { return s.tx, s.err }

type launchStoreMock struct {
	getShipCache     func(context.Context, pgtype.UUID) (database.UserShipStateCache, error)
	getCurrentByUser func(context.Context, pgtype.UUID) (database.Expedition, error)
	getLastResolveAt func(context.Context, pgtype.UUID) (pgtype.Timestamptz, error)
	insertExpedition func(context.Context, database.InsertExpeditionParams) (database.Expedition, error)
	insertOutbox     func(context.Context, database.InsertOutboxParams) error
}

func (m *launchStoreMock) GetShipCache(ctx context.Context, id pgtype.UUID) (database.UserShipStateCache, error) {
	return m.getShipCache(ctx, id)
}

func (m *launchStoreMock) GetCurrentByUser(ctx context.Context, id pgtype.UUID) (database.Expedition, error) {
	return m.getCurrentByUser(ctx, id)
}

func (m *launchStoreMock) GetLastResolveAt(ctx context.Context, id pgtype.UUID) (pgtype.Timestamptz, error) {
	return m.getLastResolveAt(ctx, id)
}

func (m *launchStoreMock) InsertExpedition(ctx context.Context, arg database.InsertExpeditionParams) (database.Expedition, error) {
	return m.insertExpedition(ctx, arg)
}

func (m *launchStoreMock) InsertOutbox(ctx context.Context, arg database.InsertOutboxParams) error {
	return m.insertOutbox(ctx, arg)
}

func TestLaunchManagerLaunch(t *testing.T) {
	userID, expeditionID := uuid.New(), uuid.New()
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	jitter := 3 * time.Hour
	tx := &launchFakeTx{}
	var outbox database.InsertOutboxParams
	store := &launchStoreMock{
		getShipCache: func(_ context.Context, got pgtype.UUID) (database.UserShipStateCache, error) {
			if got.Bytes != userID {
				t.Errorf("GetShipCache user = %s, want %s", got.Bytes, userID)
			}
			return database.UserShipStateCache{HullHealth: 80, MaterialsBalance: 25}, nil
		},
		getCurrentByUser: func(context.Context, pgtype.UUID) (database.Expedition, error) {
			return database.Expedition{}, pgx.ErrNoRows
		},
		getLastResolveAt: func(context.Context, pgtype.UUID) (pgtype.Timestamptz, error) {
			return pgtype.Timestamptz{}, pgx.ErrNoRows
		},
		insertExpedition: func(_ context.Context, arg database.InsertExpeditionParams) (database.Expedition, error) {
			if arg.MaterialsInvested != 10 || arg.SuccessChance != 0.4 || arg.Status != StatusInFlight {
				t.Errorf("InsertExpedition args = %+v", arg)
			}
			wantResolveAt := now.Add(7*24*time.Hour + jitter)
			if !arg.ResolveAt.Time.Equal(wantResolveAt) {
				t.Errorf("resolve_at = %s, want %s", arg.ResolveAt.Time, wantResolveAt)
			}
			return database.Expedition{
				ID: pgtype.UUID{Bytes: expeditionID, Valid: true}, UserID: arg.UserID, MaterialsInvested: arg.MaterialsInvested,
				SuccessChance: arg.SuccessChance, ResolveAt: arg.ResolveAt, Status: arg.Status,
				CreatedAt: pgtype.Timestamptz{Time: now, Valid: true},
			}, nil
		},
		insertOutbox: func(_ context.Context, arg database.InsertOutboxParams) error {
			outbox = arg
			return nil
		},
	}
	manager := NewManager(nil, launchTxStarter{tx: tx}, func(pgx.Tx) LaunchStore { return store }, WithClock(func() time.Time { return now }), WithJitter(func() time.Duration { return jitter }))

	record, err := manager.Launch(t.Context(), userID, LaunchInput{MaterialsInvested: 10, RequestID: "launch-request"})
	if err != nil {
		t.Fatalf("Launch() error = %v", err)
	}
	if !tx.committed {
		t.Error("transaction was not committed")
	}
	if record.SuccessChance != 0.4 || record.Status != StatusInFlight {
		t.Errorf("record = %+v", record)
	}
	if outbox.EventType != EventTypeLaunched || !outbox.EventID.Valid {
		t.Errorf("outbox = %+v", outbox)
	}
	if !outbox.RequestID.Valid || outbox.RequestID.String != "launch-request" {
		t.Errorf("outbox request ID = %+v, want launch-request", outbox.RequestID)
	}
	var payload events.ExpeditionLaunched
	if err := json.Unmarshal(outbox.Payload, &payload); err != nil {
		t.Fatalf("decode outbox payload: %v", err)
	}
	if payload.Version != 1 || payload.UserID != userID.String() || payload.ExpeditionID != expeditionID.String() || payload.MaterialsInvested != 10 || payload.SuccessChance != 0.4 {
		t.Errorf("payload = %+v", payload)
	}
}

func TestLaunchManagerLaunchRules(t *testing.T) {
	userID := uuid.New()
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name       string
		input      LaunchInput
		balance    int32
		currentErr error
		last       pgtype.Timestamptz
		lastErr    error
		wantErr    error
	}{
		{name: "rejects non-positive materials", input: LaunchInput{}, wantErr: ErrInvalidMaterials},
		{name: "rejects insufficient materials", input: LaunchInput{MaterialsInvested: 11}, balance: 10, currentErr: pgx.ErrNoRows, lastErr: pgx.ErrNoRows, wantErr: ErrInsufficientMaterials},
		{name: "rejects active expedition", input: LaunchInput{MaterialsInvested: 1}, balance: 10, wantErr: ErrAlreadyActive},
		{name: "rejects cooldown boundary", input: LaunchInput{MaterialsInvested: 1}, balance: 10, currentErr: pgx.ErrNoRows, last: pgtype.Timestamptz{Time: now.Add(-7 * 24 * time.Hour), Valid: true}, wantErr: ErrCooldown},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &launchStoreMock{
				getShipCache: func(context.Context, pgtype.UUID) (database.UserShipStateCache, error) {
					return database.UserShipStateCache{HullHealth: 100, MaterialsBalance: test.balance}, nil
				},
				getCurrentByUser: func(context.Context, pgtype.UUID) (database.Expedition, error) {
					return database.Expedition{}, test.currentErr
				},
				getLastResolveAt: func(context.Context, pgtype.UUID) (pgtype.Timestamptz, error) {
					return test.last, test.lastErr
				},
			}
			manager := NewManager(nil, launchTxStarter{tx: &launchFakeTx{}}, func(pgx.Tx) LaunchStore { return store }, WithClock(func() time.Time { return now }))
			_, err := manager.Launch(t.Context(), userID, test.input)
			if !errors.Is(err, test.wantErr) {
				t.Errorf("Launch() error = %v, want %v", err, test.wantErr)
			}
		})
	}
}
