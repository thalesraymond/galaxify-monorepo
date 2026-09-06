package consumer

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// HandleUserCreated applies the user.created domain mutation.
func HandleUserCreated(ctx context.Context, tx pgx.Tx, env events.Envelope, data events.UserCreated) error {
	userID, err := sharedhttp.ParseUUID(data.UserID)
	if err != nil {
		return fmt.Errorf("invalid user_id %q: %w", data.UserID, err)
	}

	db := database.New(tx)
	return db.UpsertUserCache(ctx, userID)
}
