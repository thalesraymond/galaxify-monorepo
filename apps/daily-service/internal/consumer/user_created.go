package consumer

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
)

type UserConsumer struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
}

func NewUserConsumer(pool *pgxpool.Pool, logger *slog.Logger) *UserConsumer {
	return &UserConsumer{
		pool:   pool,
		logger: logger,
	}
}

func (c *UserConsumer) HandleUserCreated(ctx context.Context, eventType string, payload []byte) error {
	var env events.Envelope
	if err := json.Unmarshal(payload, &env); err != nil {
		return fmt.Errorf("unmarshal envelope: %w", err)
	}

	var data events.UserCreated
	if err := json.Unmarshal(env.Payload, &data); err != nil {
		return fmt.Errorf("unmarshal UserCreated payload: %w", err)
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

	if err := db.UpsertUserCache(ctx, userID); err != nil {
		return fmt.Errorf("upsert user cache: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}

	c.logger.Info("Successfully processed user.created event", "event_id", env.EventId, "user_id", data.UserID)
	return nil
}
