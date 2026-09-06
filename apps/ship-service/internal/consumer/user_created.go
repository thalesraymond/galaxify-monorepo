package consumer

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

const (
	defaultHullHealth       = 100
	defaultMaterialsBalance = 0
	defaultLevel            = 1
)

// HandleUserCreated applies the user.created domain mutation: provisioning an initial ship.
func HandleUserCreated(ctx context.Context, tx pgx.Tx, env events.Envelope, data events.UserCreated) error {
	userID, err := sharedhttp.ParseUUID(data.UserID)
	if err != nil {
		return fmt.Errorf("invalid user_id %q: %w", data.UserID, err)
	}

	db := database.New(tx)
	err = db.CreateShip(ctx, database.CreateShipParams{
		UserID:           userID,
		HullHealth:       defaultHullHealth,
		MaterialsBalance: defaultMaterialsBalance,
		Level:            defaultLevel,
	})
	if err != nil {
		return fmt.Errorf("create ship: %w", err)
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
