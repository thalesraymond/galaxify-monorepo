package consumer

import (
	"context"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5"

	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// HandleShipStatusUpdated updates the local read-only ship-state cache.
func HandleShipStatusUpdated(
	ctx context.Context,
	tx pgx.Tx,
	_ events.Envelope,
	data events.ShipStatusUpdated,
) error {
	userID, err := sharedhttp.ParseUUID(data.UserID)
	if err != nil {
		return fmt.Errorf("invalid user_id %q: %w", data.UserID, err)
	}

	if data.HullHealth < 0 || data.HullHealth > 100 {
		return fmt.Errorf("invalid hull_health %d", data.HullHealth)
	}
	if data.MaterialsBalance < 0 || data.MaterialsBalance > math.MaxInt32 {
		return fmt.Errorf("invalid materials_balance %d", data.MaterialsBalance)
	}

	_, err = database.New(tx).UpsertShipCache(ctx, database.UpsertShipCacheParams{
		UserID:           userID,
		HullHealth:       int32(data.HullHealth),
		MaterialsBalance: int32(data.MaterialsBalance),
	})
	if err != nil {
		return fmt.Errorf("upsert ship cache: %w", err)
	}

	return nil
}

// NewShipStatusUpdatedHandler creates an idempotent HandlerFunc for ship.status_updated events.
func NewShipStatusUpdatedHandler(
	pool events.TxStarter,
	storeFactory func(tx pgx.Tx) events.IdempotencyStore,
	opts ...events.ConsumerOption,
) events.HandlerFunc {
	return events.NewIdempotentHandler(
		pool,
		storeFactory,
		HandleShipStatusUpdated,
		opts...,
	)
}
