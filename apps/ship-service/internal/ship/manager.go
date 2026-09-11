// Package ship owns ship lifecycle operations and their game-mechanics rules.
package ship

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

var (
	ErrNotFound              = errors.New("ship not found")
	ErrHullFull              = errors.New("ship hull is full")
	ErrInsufficientMaterials = errors.New("ship has insufficient materials")
)

const statusUpdatedEventType = "ship.status_updated"

// State is a ship's current, externally visible state.
type State struct {
	UserID           uuid.UUID
	HullHealth       int32
	MaterialsBalance int32
	Level            int32
	UpdatedAt        time.Time
}

// Manager executes ship lifecycle operations.
type Manager interface {
	Get(ctx context.Context, userID uuid.UUID) (State, error)
	Repair(ctx context.Context, userID uuid.UUID) (State, error)
}

// Store is the database surface required by the ship manager.
// *database.Queries satisfies it directly.
type Store interface {
	GetByUser(ctx context.Context, userID pgtype.UUID) (database.Ship, error)
	Repair(ctx context.Context, params database.RepairParams) (database.Ship, error)
	InsertOutbox(ctx context.Context, arg database.InsertOutboxParams) error
}

type repairRoll func() int

type manager struct {
	store        Store
	txStarter    events.TxStarter
	storeFactory func(tx pgx.Tx) Store
	roll         repairRoll
}

// NewManager constructs the ship lifecycle manager.
func NewManager(store Store, txStarter events.TxStarter, storeFactory func(tx pgx.Tx) Store) Manager {
	return newManager(store, txStarter, storeFactory, func() int { return rand.IntN(6) - 2 })
}

func newManager(store Store, txStarter events.TxStarter, storeFactory func(tx pgx.Tx) Store, roll repairRoll) *manager {
	return &manager{store: store, txStarter: txStarter, storeFactory: storeFactory, roll: roll}
}

// Get retrieves the current state of a user's ship.
func (m *manager) Get(ctx context.Context, userID uuid.UUID) (State, error) {
	current, err := getShip(ctx, m.store, userID)
	if err != nil {
		return State{}, err
	}
	return stateFromDatabase(current), nil
}

// Repair spends materials to restore hull health and stages the resulting state.
func (m *manager) Repair(ctx context.Context, userID uuid.UUID) (State, error) {
	tx, err := m.txStarter.Begin(ctx)
	if err != nil {
		return State{}, fmt.Errorf("begin repair transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	store := m.storeFactory(tx)
	current, err := getShip(ctx, store, userID)
	if err != nil {
		return State{}, err
	}
	if current.HullHealth == 100 {
		return State{}, ErrHullFull
	}
	if current.MaterialsBalance == 0 {
		return State{}, ErrInsufficientMaterials
	}

	materialsToUse, hullToRestore := m.repairAmounts(current)
	updated, err := store.Repair(ctx, database.RepairParams{UserID: current.UserID, MaterialsBalance: materialsToUse, HullHealth: hullToRestore})
	if err != nil {
		return State{}, fmt.Errorf("repair ship: %w", err)
	}
	state := stateFromDatabase(updated)

	payload, err := json.Marshal(events.ShipStatusUpdated{
		Version:          1,
		UserID:           state.UserID.String(),
		HullHealth:       int(state.HullHealth),
		MaterialsBalance: int(state.MaterialsBalance),
	})
	if err != nil {
		return State{}, fmt.Errorf("marshal ship status event: %w", err)
	}
	requestID := sharedhttp.RequestIDFromContext(ctx)
	if err := store.InsertOutbox(ctx, database.InsertOutboxParams{
		EventID:   pgtype.UUID{Bytes: uuid.New(), Valid: true},
		EventType: statusUpdatedEventType,
		Payload:   payload,
		RequestID: pgtype.Text{String: requestID, Valid: requestID != ""},
	}); err != nil {
		return State{}, fmt.Errorf("insert ship status outbox event: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return State{}, fmt.Errorf("commit repair transaction: %w", err)
	}
	return state, nil
}

func getShip(ctx context.Context, store Store, userID uuid.UUID) (database.Ship, error) {
	parsedUserID := pgtype.UUID{Bytes: userID, Valid: true}
	current, err := store.GetByUser(ctx, parsedUserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return database.Ship{}, ErrNotFound
		}
		return database.Ship{}, fmt.Errorf("get ship: %w", err)
	}
	return current, nil
}

func (m *manager) repairAmounts(current database.Ship) (materialsToUse, hullToRestore int32) {
	deficit := 100 - current.HullHealth
	materialsToUse = min(deficit, current.MaterialsBalance)
	for range materialsToUse {
		hullToRestore += int32(5 + m.roll())
	}
	return materialsToUse, min(deficit, hullToRestore)
}

func stateFromDatabase(ship database.Ship) State {
	return State{
		UserID:           uuid.UUID(ship.UserID.Bytes),
		HullHealth:       ship.HullHealth,
		MaterialsBalance: ship.MaterialsBalance,
		Level:            ship.Level,
		UpdatedAt:        ship.UpdatedAt.Time,
	}
}

var _ Manager = (*manager)(nil)
