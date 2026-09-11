package consumer

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// HandleExpeditionLaunched deducts invested materials and stages the resulting ship state.
func HandleExpeditionLaunched(
	ctx context.Context,
	tx pgx.Tx,
	_ events.Envelope,
	data events.ExpeditionLaunched,
) error {
	userID, err := sharedhttp.ParseUUID(data.UserID)
	if err != nil {
		return fmt.Errorf("invalid user_id %q: %w", data.UserID, err)
	}

	ship, err := database.New(tx).DeductMaterials(ctx, database.DeductMaterialsParams{
		MaterialsBalance: int32(data.MaterialsInvested),
		UserID:           userID,
	})
	if err != nil {
		return fmt.Errorf("deduct materials: %w", err)
	}

	if err := stageShipStatus(ctx, tx, data.UserID, ship); err != nil {
		return err
	}
	return nil
}

// NewExpeditionLaunchedHandler creates an idempotent HandlerFunc for expedition.launched events.
func NewExpeditionLaunchedHandler(
	pool events.TxStarter,
	storeFactory func(tx pgx.Tx) events.IdempotencyStore,
	opts ...events.ConsumerOption,
) events.HandlerFunc {
	return events.NewIdempotentHandler(
		pool,
		storeFactory,
		func(ctx context.Context, tx pgx.Tx, env events.Envelope, data events.ExpeditionLaunched) error {
			return HandleExpeditionLaunched(ctx, tx, env, data)
		},
		opts...,
	)
}
