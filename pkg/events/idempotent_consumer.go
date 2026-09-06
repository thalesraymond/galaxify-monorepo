package events

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// TxStarter abstracts opening a database transaction.
// *pgxpool.Pool satisfies TxStarter directly in production.
type TxStarter interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// IdempotencyStore abstracts the deduplication query.
// It is satisfied by each service's sqlc-generated *database.Queries type.
type IdempotencyStore interface {
	InsertProcessedEvent(ctx context.Context, eventID pgtype.UUID) (int64, error)
}

// ConsumerOption configures pipeline options (e.g. custom logger).
type ConsumerOption = Option

// NewIdempotentHandler constructs an events.HandlerFunc that decodes payload T,
// ensures idempotency against processed_events, and executes handler inside an atomic tx.
func NewIdempotentHandler[T any](
	pool TxStarter,
	storeFactory func(tx pgx.Tx) IdempotencyStore,
	handler func(ctx context.Context, tx pgx.Tx, env Envelope, data T) error,
	opts ...ConsumerOption,
) HandlerFunc {
	o := applyOptions(opts)

	return func(ctx context.Context, eventType string, payload []byte) error {
		var env Envelope
		if err := json.Unmarshal(payload, &env); err != nil {
			o.logger.Error("failed to unmarshal envelope", "event_type", eventType, "error", err)
			return fmt.Errorf("unmarshal envelope: %w", err)
		}

		eventUUID, err := sharedhttp.ParseUUID(env.EventId)
		if err != nil {
			o.logger.Error("invalid event_id in envelope", "event_id", env.EventId, "event_type", eventType, "error", err)
			return fmt.Errorf("invalid event_id %q: %w", env.EventId, err)
		}

		var data T
		if err := json.Unmarshal(env.Payload, &data); err != nil {
			o.logger.Error("failed to unmarshal payload", "event_id", env.EventId, "event_type", eventType, "error", err)
			return fmt.Errorf("unmarshal payload: %w", err)
		}

		tx, err := pool.Begin(ctx)
		if err != nil {
			o.logger.Error("failed to begin transaction", "event_id", env.EventId, "event_type", eventType, "error", err)
			return fmt.Errorf("begin tx: %w", err)
		}
		defer tx.Rollback(ctx)

		store := storeFactory(tx)
		rows, err := store.InsertProcessedEvent(ctx, eventUUID)
		if err != nil {
			o.logger.Error("failed to insert processed event", "event_id", env.EventId, "event_type", eventType, "error", err)
			return fmt.Errorf("insert processed event: %w", err)
		}

		if rows == 0 {
			o.logger.Info("event already processed, skipping", "event_id", env.EventId, "event_type", eventType)
			_ = tx.Rollback(ctx)
			return nil
		}

		if err := handler(ctx, tx, env, data); err != nil {
			o.logger.Error("handler failed", "event_id", env.EventId, "event_type", eventType, "error", err)
			return fmt.Errorf("handler: %w", err)
		}

		if err := tx.Commit(ctx); err != nil {
			o.logger.Error("failed to commit transaction", "event_id", env.EventId, "event_type", eventType, "error", err)
			return fmt.Errorf("commit tx: %w", err)
		}

		o.logger.Info("successfully processed event", "event_id", env.EventId, "event_type", eventType)
		return nil
	}
}
