package consumer

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// HandleDailyMissed applies damage and publishes the resulting ship state.
func HandleDailyMissed(
	ctx context.Context,
	tx pgx.Tx,
	_ events.Envelope,
	data events.DailyMissed,
	eventPublisher events.EventPublisher,
) error {
	userID, err := sharedhttp.ParseUUID(data.UserID)
	if err != nil {
		return fmt.Errorf("invalid user_id %q: %w", data.UserID, err)
	}

	ship, err := database.New(tx).ApplyDamage(ctx, database.ApplyDamageParams{
		UserID:     userID,
		HullHealth: int32(data.DamageAmount),
	})
	if err != nil {
		return fmt.Errorf("apply damage: %w", err)
	}

	if err := publishShipStatus(ctx, eventPublisher, data.UserID, ship); err != nil {
		return err
	}
	return nil
}

// NewDailyMissedHandler creates an idempotent HandlerFunc for daily.missed events.
func NewDailyMissedHandler(
	pool events.TxStarter,
	storeFactory func(tx pgx.Tx) events.IdempotencyStore,
	eventPublisher events.EventPublisher,
	opts ...events.ConsumerOption,
) events.HandlerFunc {
	return events.NewIdempotentHandler(
		pool,
		storeFactory,
		func(ctx context.Context, tx pgx.Tx, env events.Envelope, data events.DailyMissed) error {
			return HandleDailyMissed(ctx, tx, env, data, eventPublisher)
		},
		opts...,
	)
}
