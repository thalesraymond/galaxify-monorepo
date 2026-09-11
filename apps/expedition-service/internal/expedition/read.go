// Package expedition owns expedition read operations and their persistence boundary.
package expedition

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/database"
)

var ErrNotFound = errors.New("expedition not found")

// Result is the outcome recorded for a resolved expedition.
type Result struct {
	ID            uuid.UUID
	ExpeditionID  uuid.UUID
	Outcome       string
	RewardSummary json.RawMessage
	CreatedAt     time.Time
}

// Record is an expedition together with its result when one has been recorded.
type Record struct {
	ID                uuid.UUID
	UserID            uuid.UUID
	MaterialsInvested int32
	SuccessChance     float64
	ResolveAt         time.Time
	Status            string
	CreatedAt         time.Time
	ResolvedAt        *time.Time
	Result            *Result
}

// ListFilter controls pagination of an expedition history.
type ListFilter struct {
	Limit  int32
	Offset int32
}

// Manager provides authenticated expedition reads.
type Manager interface {
	Current(ctx context.Context, userID uuid.UUID) (Record, error)
	Get(ctx context.Context, userID, expeditionID uuid.UUID) (Record, error)
	List(ctx context.Context, userID uuid.UUID, filter ListFilter) ([]Record, error)
	Launch(ctx context.Context, userID uuid.UUID, input LaunchInput) (Record, error)
}

type readStore interface {
	GetCurrentByUser(context.Context, pgtype.UUID) (database.Expedition, error)
	GetByIDAndUser(context.Context, database.GetByIDAndUserParams) (database.Expedition, error)
	GetResultByExpedition(context.Context, pgtype.UUID) (database.ExpeditionResult, error)
	ListByUser(context.Context, database.ListByUserParams) ([]database.Expedition, error)
}

type manager struct {
	store              readStore
	txStarter          TxStarter
	launchStoreFactory func(pgx.Tx) LaunchStore
	now                func() time.Time
	jitter             func() time.Duration
}

// NewManager creates the expedition lifecycle manager.
func NewManager(store readStore, txStarter TxStarter, launchStoreFactory func(pgx.Tx) LaunchStore, opts ...ManagerOption) Manager {
	manager := &manager{
		store: store, txStarter: txStarter, launchStoreFactory: launchStoreFactory,
		now: time.Now, jitter: defaultLaunchJitter,
	}
	for _, opt := range opts {
		opt(manager)
	}
	return manager
}

func (m *manager) Current(ctx context.Context, userID uuid.UUID) (Record, error) {
	expedition, err := m.store.GetCurrentByUser(ctx, pgUUID(userID))
	if err != nil {
		return Record{}, mapReadError("get current expedition", err)
	}
	return recordFromDatabase(expedition), nil
}

func (m *manager) Get(ctx context.Context, userID, expeditionID uuid.UUID) (Record, error) {
	expedition, err := m.store.GetByIDAndUser(ctx, database.GetByIDAndUserParams{
		ID:     pgUUID(expeditionID),
		UserID: pgUUID(userID),
	})
	if err != nil {
		return Record{}, mapReadError("get expedition", err)
	}
	return m.withResult(ctx, expedition)
}

func (m *manager) List(ctx context.Context, userID uuid.UUID, filter ListFilter) ([]Record, error) {
	expeditions, err := m.store.ListByUser(ctx, database.ListByUserParams{
		UserID: pgUUID(userID),
		Limit:  filter.Limit,
		Offset: filter.Offset,
	})
	if err != nil {
		return nil, fmt.Errorf("list expeditions: %w", err)
	}

	records := make([]Record, 0, len(expeditions))
	for _, expedition := range expeditions {
		record, err := m.withResult(ctx, expedition)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, nil
}

func (m *manager) withResult(ctx context.Context, expedition database.Expedition) (Record, error) {
	record := recordFromDatabase(expedition)
	result, err := m.store.GetResultByExpedition(ctx, expedition.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return record, nil
	}
	if err != nil {
		return Record{}, fmt.Errorf("get expedition result: %w", err)
	}
	record.Result = resultFromDatabase(result)
	return record, nil
}

func mapReadError(operation string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return fmt.Errorf("%s: %w", operation, err)
}

func recordFromDatabase(expedition database.Expedition) Record {
	record := Record{
		ID:                uuid.UUID(expedition.ID.Bytes),
		UserID:            uuid.UUID(expedition.UserID.Bytes),
		MaterialsInvested: expedition.MaterialsInvested,
		SuccessChance:     expedition.SuccessChance,
		ResolveAt:         expedition.ResolveAt.Time,
		Status:            expedition.Status,
		CreatedAt:         expedition.CreatedAt.Time,
	}
	if expedition.ResolvedAt.Valid {
		resolvedAt := expedition.ResolvedAt.Time
		record.ResolvedAt = &resolvedAt
	}
	return record
}

func resultFromDatabase(result database.ExpeditionResult) *Result {
	return &Result{
		ID:            uuid.UUID(result.ID.Bytes),
		ExpeditionID:  uuid.UUID(result.ExpeditionID.Bytes),
		Outcome:       result.Outcome,
		RewardSummary: append(json.RawMessage(nil), result.RewardSummary...),
		CreatedAt:     result.CreatedAt.Time,
	}
}

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

var _ Manager = (*manager)(nil)
