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
	expeditionOutcomeSuccess = "SUCCESS"
	expeditionOutcomeFailure = "FAILURE"
)

// HandleExpeditionCompleted grants successful expedition rewards and stages the resulting ship state.
func HandleExpeditionCompleted(
	ctx context.Context,
	tx pgx.Tx,
	_ events.Envelope,
	data events.ExpeditionCompleted,
) error {
	switch data.Outcome {
	case expeditionOutcomeFailure:
		return nil
	case expeditionOutcomeSuccess:
		// Continue with the reward.
	default:
		return fmt.Errorf("invalid outcome %q", data.Outcome)
	}

	userID, err := sharedhttp.ParseUUID(data.UserID)
	if err != nil {
		return fmt.Errorf("invalid user_id %q: %w", data.UserID, err)
	}

	ship, err := database.New(tx).AddMaterials(ctx, database.AddMaterialsParams{
		UserID:           userID,
		MaterialsBalance: int32(data.MaterialsReward),
	})
	if err != nil {
		return fmt.Errorf("add expedition reward: %w", err)
	}

	if err := stageShipStatus(ctx, tx, data.UserID, ship); err != nil {
		return err
	}
	return nil
}

// NewExpeditionCompletedHandler creates an idempotent HandlerFunc for expedition.completed events.
func NewExpeditionCompletedHandler(
	pool events.TxStarter,
	storeFactory func(tx pgx.Tx) events.IdempotencyStore,
	opts ...events.ConsumerOption,
) events.HandlerFunc {
	return events.NewIdempotentHandler(
		pool,
		storeFactory,
		func(ctx context.Context, tx pgx.Tx, env events.Envelope, data events.ExpeditionCompleted) error {
			return HandleExpeditionCompleted(ctx, tx, env, data)
		},
		opts...,
	)
}
