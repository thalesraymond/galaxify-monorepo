package consumer

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
)

func TestHandleUserCreated(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, "postgres://postgres:password@localhost:5432/daily_db")
	if err != nil {
		t.Skipf("skipping test, db not available: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		t.Skipf("skipping test, db ping failed: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	c := NewUserConsumer(pool, logger)

	// Clean up before test (optional)
	// But we'll just generate fresh UUIDs
	userID := uuid.New().String()
	eventID := uuid.New().String()

	payloadData := events.UserCreated{
		Version:  1,
		UserID:   userID,
		Email:    "test@example.com",
		Username: "testuser",
	}

	payloadBytes, _ := json.Marshal(payloadData)

	env := events.Envelope{
		EventId:    eventID,
		Payload:    payloadBytes,
	}

	envBytes, _ := json.Marshal(env)

	checkCache := func() {
		t.Helper()
		var count int
		err = pool.QueryRow(ctx, "SELECT count(*) FROM users_cache WHERE id = $1", userID).Scan(&count)
		if err != nil {
			t.Fatalf("failed to query users_cache: %v", err)
		}
		if count != 1 {
			t.Errorf("expected 1 user in cache, got %d", count)
		}
	}

	// 1. Process event first time
	if err := c.HandleUserCreated(ctx, "user.created", envBytes); err != nil {
		t.Fatalf("first HandleUserCreated failed: %v", err)
	}
	checkCache()

	// 2. Process same event again (idempotency)
	if err := c.HandleUserCreated(ctx, "user.created", envBytes); err != nil {
		t.Fatalf("second HandleUserCreated failed: %v", err)
	}
	checkCache()

	// 3. Process new event with same user_id (should upsert safely)
	env.EventId = uuid.New().String()
	envBytes2, _ := json.Marshal(env)

	if err := c.HandleUserCreated(ctx, "user.created", envBytes2); err != nil {
		t.Fatalf("third HandleUserCreated failed: %v", err)
	}
	checkCache()
}
