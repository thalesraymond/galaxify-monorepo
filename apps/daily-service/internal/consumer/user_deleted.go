package consumer

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
)


func (c *UserConsumer) HandleUserDeleted(ctx context.Context, eventType string, payload []byte) error {
	var env events.Envelope
	if err := json.Unmarshal(payload, &env); err != nil {
		return fmt.Errorf("unmarshal envelope: %w", err)
	}

	var data events.UserDeleted
	if err := json.Unmarshal(env.Payload, &data); err != nil {
		return fmt.Errorf("unmarshal UserDeleted payload: %w", err)
	}

	var userID pgtype.UUID
	if err := userID.Scan(data.UserID); err != nil {
		return fmt.Errorf("invalid user_id %q: %w", data.UserID, err)
	}

	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	db := database.New(tx)
	idempotency := events.NewProcessedEvents(db)

	shouldProcess, err := idempotency.MarkProcessed(ctx, env.EventId)
	if err != nil {
		return fmt.Errorf("check idempotency: %w", err)
	}

	if !shouldProcess {
		c.logger.Info("Event already processed, skipping", "event_id", env.EventId)
		return nil
	}

	if err := db.DeleteUserCache(ctx, userID); err != nil {
		return fmt.Errorf("delete user cache: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}

	c.logger.Info("Successfully processed user.deleted event", "event_id", env.EventId, "user_id", data.UserID)
	return nil
}
