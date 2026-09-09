package consumer

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

const (
	initialHullHealth       = 100
	initialMaterialsBalance = 0
)

// HandleUserCreated seeds the local ship-state cache for a new user.
func HandleUserCreated(
	ctx context.Context,
	tx pgx.Tx,
	_ events.Envelope,
	data events.UserCreated,
) error {
	userID, err := sharedhttp.ParseUUID(data.UserID)
	if err != nil {
		return fmt.Errorf("invalid user_id %q: %w", data.UserID, err)
	}

	err = database.New(tx).SeedShipCache(ctx, database.SeedShipCacheParams{
		UserID:           userID,
		HullHealth:       initialHullHealth,
		MaterialsBalance: initialMaterialsBalance,
	})
	if err != nil {
		return fmt.Errorf("seed ship cache: %w", err)
	}

	return nil
}

// NewUserCreatedHandler creates an idempotent HandlerFunc for user.created events.
func NewUserCreatedHandler(
	pool events.TxStarter,
	storeFactory func(tx pgx.Tx) events.IdempotencyStore,
	opts ...events.ConsumerOption,
) events.HandlerFunc {
	return events.NewIdempotentHandler(
		pool,
		storeFactory,
		HandleUserCreated,
		opts...,
	)
}
