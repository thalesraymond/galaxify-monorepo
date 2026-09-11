package consumer

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

const shipStatusUpdatedEventType = "ship.status_updated"

// HandleDailyCompleted adds earned materials and stages the resulting ship state.
func HandleDailyCompleted(
	ctx context.Context,
	tx pgx.Tx,
	_ events.Envelope,
	data events.DailyCompleted,
) error {
	userID, err := sharedhttp.ParseUUID(data.UserID)
	if err != nil {
		return fmt.Errorf("invalid user_id %q: %w", data.UserID, err)
	}

	ship, err := database.New(tx).AddMaterials(ctx, database.AddMaterialsParams{
		UserID:           userID,
		MaterialsBalance: int32(data.RewardMaterials),
	})
	if err != nil {
		return fmt.Errorf("add materials: %w", err)
	}

	if err := stageShipStatus(ctx, tx, data.UserID, ship); err != nil {
		return err
	}
	return nil
}

// NewDailyCompletedHandler creates an idempotent HandlerFunc for daily.completed events.
func NewDailyCompletedHandler(
	pool events.TxStarter,
	storeFactory func(tx pgx.Tx) events.IdempotencyStore,
	opts ...events.ConsumerOption,
) events.HandlerFunc {
	return events.NewIdempotentHandler(
		pool,
		storeFactory,
		func(ctx context.Context, tx pgx.Tx, env events.Envelope, data events.DailyCompleted) error {
			return HandleDailyCompleted(ctx, tx, env, data)
		},
		opts...,
	)
}

// stageShipStatus inserts the ship.status_updated event into the outbox in the
// same transaction as the ship mutation. The shared drainer publishes it after
// the transaction commits.
func stageShipStatus(ctx context.Context, tx pgx.Tx, userID string, ship database.Ship) error {
	payload, err := json.Marshal(events.ShipStatusUpdated{
		Version:          1,
		UserID:           userID,
		HullHealth:       int(ship.HullHealth),
		MaterialsBalance: int(ship.MaterialsBalance),
	})
	if err != nil {
		return fmt.Errorf("marshal ship status: %w", err)
	}
	if err := database.New(tx).InsertOutbox(ctx, database.InsertOutboxParams{
		EventID:   pgtype.UUID{Bytes: uuid.New(), Valid: true},
		EventType: shipStatusUpdatedEventType,
		Payload:   payload,
	}); err != nil {
		return fmt.Errorf("insert ship status outbox event: %w", err)
	}
	return nil
}
