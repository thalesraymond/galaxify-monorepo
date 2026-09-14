package expedition

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/database"
)

type readStoreMock struct {
	getShipCache          func(context.Context, pgtype.UUID) (database.UserShipStateCache, error)
	getCurrentByUser      func(context.Context, pgtype.UUID) (database.Expedition, error)
	getByIDAndUser        func(context.Context, database.GetByIDAndUserParams) (database.Expedition, error)
	getResultByExpedition func(context.Context, pgtype.UUID) (database.ExpeditionResult, error)
	getLastResolveAt      func(context.Context, pgtype.UUID) (pgtype.Timestamptz, error)
	listByUser            func(context.Context, database.ListByUserParams) ([]database.Expedition, error)
}

func (m *readStoreMock) GetShipCache(ctx context.Context, userID pgtype.UUID) (database.UserShipStateCache, error) {
	if m.getShipCache == nil {
		return database.UserShipStateCache{}, errors.New("unexpected GetShipCache call")
	}
	return m.getShipCache(ctx, userID)
}

func (m *readStoreMock) GetCurrentByUser(ctx context.Context, userID pgtype.UUID) (database.Expedition, error) {
	if m.getCurrentByUser == nil {
		return database.Expedition{}, errors.New("unexpected GetCurrentByUser call")
	}
	return m.getCurrentByUser(ctx, userID)
}

func (m *readStoreMock) GetByIDAndUser(ctx context.Context, arg database.GetByIDAndUserParams) (database.Expedition, error) {
	if m.getByIDAndUser == nil {
		return database.Expedition{}, errors.New("unexpected GetByIDAndUser call")
	}
	return m.getByIDAndUser(ctx, arg)
}

func (m *readStoreMock) GetResultByExpedition(ctx context.Context, expeditionID pgtype.UUID) (database.ExpeditionResult, error) {
	if m.getResultByExpedition == nil {
		return database.ExpeditionResult{}, errors.New("unexpected GetResultByExpedition call")
	}
	return m.getResultByExpedition(ctx, expeditionID)
}

func (m *readStoreMock) GetLastResolveAt(ctx context.Context, userID pgtype.UUID) (pgtype.Timestamptz, error) {
	if m.getLastResolveAt == nil {
		return pgtype.Timestamptz{}, errors.New("unexpected GetLastResolveAt call")
	}
	return m.getLastResolveAt(ctx, userID)
}

func (m *readStoreMock) ListByUser(ctx context.Context, arg database.ListByUserParams) ([]database.Expedition, error) {
	if m.listByUser == nil {
		return nil, errors.New("unexpected ListByUser call")
	}
	return m.listByUser(ctx, arg)
}

func TestManagerQuoteCalculatesAuthoritativeFacts(t *testing.T) {
	userID := uuid.New()
	now := time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)
	store := &readStoreMock{
		getShipCache: func(context.Context, pgtype.UUID) (database.UserShipStateCache, error) {
			return database.UserShipStateCache{HullHealth: 80, MaterialsBalance: 25}, nil
		},
		getCurrentByUser: func(context.Context, pgtype.UUID) (database.Expedition, error) {
			return database.Expedition{}, pgx.ErrNoRows
		},
		getLastResolveAt: func(context.Context, pgtype.UUID) (pgtype.Timestamptz, error) {
			return pgtype.Timestamptz{}, pgx.ErrNoRows
		},
	}
	manager := NewManager(store, nil, nil, WithClock(func() time.Time { return now }))

	quote, err := manager.Quote(t.Context(), userID, 10)
	if err != nil {
		t.Fatalf("Quote() error = %v", err)
	}

	if quote.MaterialsInvested != 10 {
		t.Errorf("MaterialsInvested = %d, want 10", quote.MaterialsInvested)
	}
	if quote.NormalizedInvestment != 0.5 {
		t.Errorf("NormalizedInvestment = %v, want 0.5", quote.NormalizedInvestment)
	}
	if quote.SuccessChance != 0.4 {
		t.Errorf("SuccessChance = %v, want 0.4", quote.SuccessChance)
	}
	if quote.ProjectedBalance != 15 {
		t.Errorf("ProjectedBalance = %d, want 15", quote.ProjectedBalance)
	}
	if !quote.Eligible || quote.Blocker != BlockerNone {
		t.Errorf("Eligible/Blocker = %t/%q, want true/empty", quote.Eligible, quote.Blocker)
	}
	if quote.CooldownUntil != nil {
		t.Errorf("CooldownUntil = %v, want nil", quote.CooldownUntil)
	}
	if want := now.Add(7 * 24 * time.Hour); !quote.EstimatedResolveAt.Equal(want) {
		t.Errorf("EstimatedResolveAt = %s, want %s", quote.EstimatedResolveAt, want)
	}
	if quote.EstimatedResolveWindow != 24*time.Hour {
		t.Errorf("EstimatedResolveWindow = %s, want 24h", quote.EstimatedResolveWindow)
	}
}

func TestManagerQuoteBlockers(t *testing.T) {
	userID := uuid.New()
	now := time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)
	active := database.Expedition{ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}}

	tests := []struct {
		name          string
		materials     int32
		ship          database.UserShipStateCache
		current       database.Expedition
		currentErr    error
		lastResolveAt pgtype.Timestamptz
		lastErr       error
		wantBlocker   Blocker
		wantCooldown  bool
	}{
		{
			name: "insufficient materials", materials: 30,
			ship:       database.UserShipStateCache{HullHealth: 100, MaterialsBalance: 25},
			currentErr: pgx.ErrNoRows, lastErr: pgx.ErrNoRows,
			wantBlocker: BlockerInsufficientMaterials,
		},
		{
			name: "already active", materials: 10,
			ship:    database.UserShipStateCache{HullHealth: 100, MaterialsBalance: 25},
			current: active, currentErr: nil,
			lastErr:     pgx.ErrNoRows,
			wantBlocker: BlockerAlreadyActive,
		},
		{
			name: "cooldown", materials: 10,
			ship:          database.UserShipStateCache{HullHealth: 100, MaterialsBalance: 25},
			currentErr:    pgx.ErrNoRows,
			lastResolveAt: pgtype.Timestamptz{Time: now.Add(-time.Hour), Valid: true},
			wantBlocker:   BlockerCooldown, wantCooldown: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &readStoreMock{
				getShipCache: func(context.Context, pgtype.UUID) (database.UserShipStateCache, error) {
					return test.ship, nil
				},
				getCurrentByUser: func(context.Context, pgtype.UUID) (database.Expedition, error) {
					return test.current, test.currentErr
				},
				getLastResolveAt: func(context.Context, pgtype.UUID) (pgtype.Timestamptz, error) {
					return test.lastResolveAt, test.lastErr
				},
			}
			manager := NewManager(store, nil, nil, WithClock(func() time.Time { return now }))

			quote, err := manager.Quote(t.Context(), userID, test.materials)
			if err != nil {
				t.Fatalf("Quote() error = %v", err)
			}
			if quote.Eligible {
				t.Error("Eligible = true, want false for a blocked quote")
			}
			if quote.Blocker != test.wantBlocker {
				t.Errorf("Blocker = %q, want %q", quote.Blocker, test.wantBlocker)
			}
			if test.wantCooldown {
				if quote.CooldownUntil == nil {
					t.Fatal("CooldownUntil = nil, want a timestamp")
				}
				if want := test.lastResolveAt.Time.Add(7 * 24 * time.Hour); !quote.CooldownUntil.Equal(want) {
					t.Errorf("CooldownUntil = %s, want %s", quote.CooldownUntil, want)
				}
			} else if quote.CooldownUntil != nil {
				t.Errorf("CooldownUntil = %v, want nil", quote.CooldownUntil)
			}
		})
	}
}

func TestManagerQuoteNotReady(t *testing.T) {
	userID := uuid.New()
	calledGetCurrent := false
	store := &readStoreMock{
		getShipCache: func(context.Context, pgtype.UUID) (database.UserShipStateCache, error) {
			return database.UserShipStateCache{}, pgx.ErrNoRows
		},
		getCurrentByUser: func(context.Context, pgtype.UUID) (database.Expedition, error) {
			calledGetCurrent = true
			return database.Expedition{}, pgx.ErrNoRows
		},
	}
	manager := NewManager(store, nil, nil)

	if _, err := manager.Quote(t.Context(), userID, 10); !errors.Is(err, ErrShipStateNotReady) {
		t.Fatalf("Quote() error = %v, want ErrShipStateNotReady", err)
	}
	if calledGetCurrent {
		t.Error("Quote read current expedition before the ship cache was provisioned")
	}
}

func TestManagerQuoteRejectsNonPositiveMaterials(t *testing.T) {
	store := &readStoreMock{}
	manager := NewManager(store, nil, nil)

	if _, err := manager.Quote(t.Context(), uuid.New(), 0); !errors.Is(err, ErrInvalidMaterials) {
		t.Fatalf("Quote() error = %v, want ErrInvalidMaterials", err)
	}
}

func TestManagerCurrentNotReady(t *testing.T) {
	userID := uuid.New()
	store := &readStoreMock{
		getShipCache: func(context.Context, pgtype.UUID) (database.UserShipStateCache, error) {
			return database.UserShipStateCache{}, pgx.ErrNoRows
		},
	}
	manager := NewManager(store, nil, nil)

	if _, err := manager.Current(t.Context(), userID); !errors.Is(err, ErrShipStateNotReady) {
		t.Fatalf("Current() error = %v, want ErrShipStateNotReady", err)
	}
}

func TestManagerGetReturnsTypedMaterialReward(t *testing.T) {
	userID, expeditionID := uuid.New(), uuid.New()
	store := &readStoreMock{
		getByIDAndUser: func(_ context.Context, arg database.GetByIDAndUserParams) (database.Expedition, error) {
			return database.Expedition{ID: arg.ID, UserID: arg.UserID, Status: "RESOLVED"}, nil
		},
		getResultByExpedition: func(context.Context, pgtype.UUID) (database.ExpeditionResult, error) {
			return database.ExpeditionResult{Outcome: "SUCCESS", MaterialsReward: 175}, nil
		},
	}
	manager := NewManager(store, nil, nil)

	record, err := manager.Get(t.Context(), userID, expeditionID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if record.Result == nil {
		t.Fatal("Result = nil, want a typed result")
	}
	if record.Result.Outcome != "SUCCESS" || record.Result.MaterialsReward != 175 {
		t.Errorf("Result = %+v, want SUCCESS with 175 materials", record.Result)
	}
}

// TestLaunchQuoteParity proves the quote reports the same eligibility rules and
// success chance launch independently enforces: whatever launch rejects with,
// the quote surfaces as a matching typed blocker.
func TestLaunchQuoteParity(t *testing.T) {
	userID := uuid.New()
	now := time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)
	active := database.Expedition{ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}}

	tests := []struct {
		name        string
		ship        database.UserShipStateCache
		current     database.Expedition
		currentErr  error
		last        pgtype.Timestamptz
		lastErr     error
		wantErr     error
		wantBlocker Blocker
	}{
		{
			name: "eligible", ship: database.UserShipStateCache{HullHealth: 80, MaterialsBalance: 25},
			currentErr: pgx.ErrNoRows, lastErr: pgx.ErrNoRows,
			wantBlocker: BlockerNone,
		},
		{
			name: "insufficient", ship: database.UserShipStateCache{HullHealth: 80, MaterialsBalance: 5},
			currentErr: pgx.ErrNoRows, lastErr: pgx.ErrNoRows,
			wantErr: ErrInsufficientMaterials, wantBlocker: BlockerInsufficientMaterials,
		},
		{
			name: "active", ship: database.UserShipStateCache{HullHealth: 80, MaterialsBalance: 25},
			current: active, lastErr: pgx.ErrNoRows,
			wantErr: ErrAlreadyActive, wantBlocker: BlockerAlreadyActive,
		},
		{
			name: "cooldown", ship: database.UserShipStateCache{HullHealth: 80, MaterialsBalance: 25},
			currentErr: pgx.ErrNoRows,
			last:       pgtype.Timestamptz{Time: now.Add(-time.Hour), Valid: true},
			wantErr:    ErrCooldown, wantBlocker: BlockerCooldown,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			launchStore := &launchStoreMock{
				getShipCache: func(context.Context, pgtype.UUID) (database.UserShipStateCache, error) {
					return test.ship, nil
				},
				getCurrentByUser: func(context.Context, pgtype.UUID) (database.Expedition, error) {
					return test.current, test.currentErr
				},
				getLastResolveAt: func(context.Context, pgtype.UUID) (pgtype.Timestamptz, error) {
					return test.last, test.lastErr
				},
				insertExpedition: func(_ context.Context, arg database.InsertExpeditionParams) (database.Expedition, error) {
					return database.Expedition{ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}, UserID: arg.UserID,
						MaterialsInvested: arg.MaterialsInvested, SuccessChance: arg.SuccessChance,
						ResolveAt: arg.ResolveAt, Status: arg.Status,
						CreatedAt: pgtype.Timestamptz{Time: now, Valid: true}}, nil
				},
				insertOutbox: func(context.Context, database.InsertOutboxParams) error { return nil },
			}
			readStore := &readStoreMock{
				getShipCache: func(context.Context, pgtype.UUID) (database.UserShipStateCache, error) {
					return test.ship, nil
				},
				getCurrentByUser: func(context.Context, pgtype.UUID) (database.Expedition, error) {
					return test.current, test.currentErr
				},
				getLastResolveAt: func(context.Context, pgtype.UUID) (pgtype.Timestamptz, error) {
					return test.last, test.lastErr
				},
			}
			launcher := NewManager(readStore, launchTxStarter{tx: &launchFakeTx{}}, func(pgx.Tx) LaunchStore { return launchStore },
				WithClock(func() time.Time { return now }), WithJitter(func() time.Duration { return 0 }))

			quote, err := launcher.Quote(t.Context(), userID, 10)
			if err != nil {
				t.Fatalf("Quote() error = %v", err)
			}
			if quote.Blocker != test.wantBlocker {
				t.Errorf("Quote blocker = %q, want %q", quote.Blocker, test.wantBlocker)
			}

			record, err := launcher.Launch(t.Context(), userID, LaunchInput{MaterialsInvested: 10})
			if test.wantErr != nil {
				if !errors.Is(err, test.wantErr) {
					t.Fatalf("Launch() error = %v, want %v", err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("Launch() error = %v, want success", err)
			}
			if record.SuccessChance != quote.SuccessChance {
				t.Errorf("Launch chance = %v, quote chance = %v, want identical", record.SuccessChance, quote.SuccessChance)
			}
		})
	}
}
