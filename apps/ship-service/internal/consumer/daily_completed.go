package consumer

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/publisher"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

const shipStatusUpdatedEventType = "ship.status_updated"

// HandleDailyCompleted adds earned materials and publishes the resulting ship state.
func HandleDailyCompleted(
	ctx context.Context,
	tx pgx.Tx,
	_ events.Envelope,
	data events.DailyCompleted,
	eventPublisher publisher.EventPublisher,
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

	if err := publishShipStatus(ctx, eventPublisher, data.UserID, ship); err != nil {
		return err
	}
	return nil
}

// NewDailyCompletedHandler creates an idempotent HandlerFunc for daily.completed events.
func NewDailyCompletedHandler(
	pool events.TxStarter,
	storeFactory func(tx pgx.Tx) events.IdempotencyStore,
	eventPublisher publisher.EventPublisher,
	opts ...events.ConsumerOption,
) events.HandlerFunc {
	return events.NewIdempotentHandler(
		pool,
		storeFactory,
		func(ctx context.Context, tx pgx.Tx, env events.Envelope, data events.DailyCompleted) error {
			return HandleDailyCompleted(ctx, tx, env, data, eventPublisher)
		},
		opts...,
	)
}

func publishShipStatus(
	ctx context.Context,
	eventPublisher publisher.EventPublisher,
	userID string,
	ship database.Ship,
) error {
	status := events.ShipStatusUpdated{
		Version:          1,
		UserID:           userID,
		HullHealth:       int(ship.HullHealth),
		MaterialsBalance: int(ship.MaterialsBalance),
	}
	if err := eventPublisher.Publish(ctx, shipStatusUpdatedEventType, status); err != nil {
		return fmt.Errorf("publish ship status: %w", err)
	}
	return nil
}
