package expedition

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
)

const (
	StatusInFlight    = "IN_FLIGHT"
	EventTypeLaunched = "expedition.launched"
	expeditionLength  = 7 * 24 * time.Hour
	jitterRange       = 12 * time.Hour
)

var (
	ErrInvalidMaterials      = errors.New("materials invested must be positive")
	ErrInsufficientMaterials = errors.New("insufficient materials")
	ErrAlreadyActive         = errors.New("expedition already active")
	ErrCooldown              = errors.New("expedition cooldown active")
)

// TxStarter abstracts opening the transaction that atomically creates an
// expedition and its outbox event.
type TxStarter interface {
	Begin(context.Context) (pgx.Tx, error)
}

// LaunchStore is the database surface required by the expedition launch lifecycle.
type LaunchStore interface {
	GetShipCache(context.Context, pgtype.UUID) (database.UserShipStateCache, error)
	GetCurrentByUser(context.Context, pgtype.UUID) (database.Expedition, error)
	GetLastResolveAt(context.Context, pgtype.UUID) (pgtype.Timestamptz, error)
	InsertExpedition(context.Context, database.InsertExpeditionParams) (database.Expedition, error)
	InsertOutbox(context.Context, database.InsertOutboxParams) error
}

// LaunchInput contains the user-controlled expedition investment.
type LaunchInput struct {
	MaterialsInvested int32
	RequestID         string
}

// Launcher creates expeditions while enforcing launch invariants.
type Launcher interface {
	Launch(context.Context, uuid.UUID, LaunchInput) (Record, error)
}

// ManagerOption configures deterministic expedition lifecycle dependencies.
type ManagerOption func(*manager)

// WithClock overrides the launch clock.
func WithClock(now func() time.Time) ManagerOption {
	return func(manager *manager) {
		if now != nil {
			manager.now = now
		}
	}
}

// WithJitter overrides resolve-time jitter generation.
func WithJitter(jitter func() time.Duration) ManagerOption {
	return func(manager *manager) {
		if jitter != nil {
			manager.jitter = jitter
		}
	}
}

func defaultLaunchJitter() time.Duration {
	return time.Duration(rand.Int64N(int64(2*jitterRange)+1)) - jitterRange
}

func (manager *manager) Launch(ctx context.Context, userID uuid.UUID, input LaunchInput) (Record, error) {
	if input.MaterialsInvested <= 0 {
		return Record{}, ErrInvalidMaterials
	}

	tx, err := manager.txStarter.Begin(ctx)
	if err != nil {
		return Record{}, fmt.Errorf("begin launch transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	store := manager.launchStoreFactory(tx)
	pgUserID := pgUUID(userID)
	ship, err := store.GetShipCache(ctx, pgUserID)
	if err != nil {
		return Record{}, fmt.Errorf("get ship cache: %w", err)
	}
	if input.MaterialsInvested > ship.MaterialsBalance {
		return Record{}, ErrInsufficientMaterials
	}

	if _, err := store.GetCurrentByUser(ctx, pgUserID); err == nil {
		return Record{}, ErrAlreadyActive
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Record{}, fmt.Errorf("get current expedition: %w", err)
	}

	now := manager.now().UTC()
	lastResolveAt, err := store.GetLastResolveAt(ctx, pgUserID)
	if err == nil && !lastResolveAt.Time.Before(now.Add(-expeditionLength)) {
		return Record{}, ErrCooldown
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Record{}, fmt.Errorf("get last expedition resolve time: %w", err)
	}

	successChance := (float64(input.MaterialsInvested) / (float64(input.MaterialsInvested) + 10)) * (float64(ship.HullHealth) / 100)
	resolveAt := now.Add(expeditionLength + manager.jitter())
	row, err := store.InsertExpedition(ctx, database.InsertExpeditionParams{
		UserID:            pgUserID,
		MaterialsInvested: input.MaterialsInvested,
		SuccessChance:     successChance,
		ResolveAt:         pgtype.Timestamptz{Time: resolveAt, Valid: true},
		Status:            StatusInFlight,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.ConstraintName == "expeditions_current_idx" {
			return Record{}, ErrAlreadyActive
		}
		return Record{}, fmt.Errorf("insert expedition: %w", err)
	}

	payload, err := json.Marshal(events.ExpeditionLaunched{
		Version:           1,
		UserID:            userID.String(),
		ExpeditionID:      uuid.UUID(row.ID.Bytes).String(),
		MaterialsInvested: int(input.MaterialsInvested),
		SuccessChance:     successChance,
		ResolveAt:         row.ResolveAt.Time.Format(time.RFC3339Nano),
	})
	if err != nil {
		return Record{}, fmt.Errorf("marshal expedition launched event: %w", err)
	}
	if err := store.InsertOutbox(ctx, database.InsertOutboxParams{
		EventID: pgUUID(uuid.New()), EventType: EventTypeLaunched, Payload: payload,
		RequestID: pgtype.Text{String: input.RequestID, Valid: input.RequestID != ""},
	}); err != nil {
		return Record{}, fmt.Errorf("insert expedition launched outbox event: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Record{}, fmt.Errorf("commit launch transaction: %w", err)
	}
	return recordFromDatabase(row), nil
}

var _ Launcher = (*manager)(nil)
