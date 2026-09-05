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

	env := struct {
		EventId string          `json:"event_id"`
		Payload json.RawMessage `json:"payload"`
	}{
		EventId: eventID,
		Payload: payloadBytes,
	}

	envBytes, _ := json.Marshal(env)

	// 1. Process event first time
	err = c.HandleUserCreated(ctx, "user.created", envBytes)
	if err != nil {
		t.Fatalf("first HandleUserCreated failed: %v", err)
	}

	// Verify user is in cache
	var count int
	err = pool.QueryRow(ctx, "SELECT count(*) FROM users_cache WHERE id = $1", userID).Scan(&count)
	if err != nil {
		t.Fatalf("failed to query users_cache: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 user in cache, got %d", count)
	}

	// 2. Process same event again (idempotency)
	err = c.HandleUserCreated(ctx, "user.created", envBytes)
	if err != nil {
		t.Fatalf("second HandleUserCreated failed: %v", err)
	}

	// Still 1 user in cache
	err = pool.QueryRow(ctx, "SELECT count(*) FROM users_cache WHERE id = $1", userID).Scan(&count)
	if err != nil {
		t.Fatalf("failed to query users_cache after retry: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 user in cache after retry, got %d", count)
	}

	// 3. Process new event with same user_id (should upsert safely)
	eventID2 := uuid.New().String()
	env2 := env
	env2.EventId = eventID2
	envBytes2, _ := json.Marshal(env2)

	err = c.HandleUserCreated(ctx, "user.created", envBytes2)
	if err != nil {
		t.Fatalf("third HandleUserCreated failed: %v", err)
	}

	err = pool.QueryRow(ctx, "SELECT count(*) FROM users_cache WHERE id = $1", userID).Scan(&count)
	if err != nil {
		t.Fatalf("failed to query users_cache after second event: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 user in cache after second event, got %d", count)
	}
}
