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

func TestHandleUserDeleted(t *testing.T) {
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

	userID := uuid.New().String()
	eventID := uuid.New().String()

	// Seed user cache
	_, err = pool.Exec(ctx, "INSERT INTO users_cache (id) VALUES ($1)", userID)
	if err != nil {
		t.Fatalf("failed to seed users_cache: %v", err)
	}

	payloadData := events.UserDeleted{
		Version: 1,
		UserID:  userID,
	}

	payloadBytes, _ := json.Marshal(payloadData)

	env := events.Envelope{
		EventId: eventID,
		Payload: payloadBytes,
	}

	envBytes, _ := json.Marshal(env)

	checkCache := func(expectedCount int) {
		t.Helper()
		var count int
		err = pool.QueryRow(ctx, "SELECT count(*) FROM users_cache WHERE id = $1", userID).Scan(&count)
		if err != nil {
			t.Fatalf("failed to query users_cache: %v", err)
		}
		if count != expectedCount {
			t.Errorf("expected %d user in cache, got %d", expectedCount, count)
		}
	}

	checkCache(1)

	// 1. Process event first time
	if err := c.HandleUserDeleted(ctx, "user.deleted", envBytes); err != nil {
		t.Fatalf("first HandleUserDeleted failed: %v", err)
	}
	checkCache(0)

	// 2. Process same event again (idempotency)
	if err := c.HandleUserDeleted(ctx, "user.deleted", envBytes); err != nil {
		t.Fatalf("second HandleUserDeleted failed: %v", err)
	}
	checkCache(0)

	// 3. Process new event with same user_id (id already deleted)
	env.EventId = uuid.New().String()
	envBytes2, _ := json.Marshal(env)

	if err := c.HandleUserDeleted(ctx, "user.deleted", envBytes2); err != nil {
		t.Fatalf("third HandleUserDeleted failed: %v", err)
	}
	checkCache(0)
}
