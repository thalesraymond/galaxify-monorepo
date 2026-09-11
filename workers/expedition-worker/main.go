package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/thalesraymond/galaxify-monorepo/pkg/env"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/rabbitmq"
	"github.com/thalesraymond/galaxify-monorepo/workers/expedition-worker/internal/expedition"
)

const serviceName = "expedition-worker"

// Defaults match docker-compose.yml so the worker runs against local
// infrastructure even without a .env file. .env overrides them.
const (
	defaultDatabaseURL = "postgres://postgres:password@localhost:5434/expedition_db"
	defaultRabbitMQURL = "amqp://guest:guest@localhost:5672/"
	defaultInterval    = 5 * time.Minute
)

// The expedition resolution, its result row, and the expedition.completed
// outbox row are committed in the same transaction (ADR-0013); the shared
// outbox drainer then publishes pending rows after each tick, giving
// at-least-once delivery (ADR-0004).

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	if err := run(logger); err != nil {
		logger.Error(serviceName+" failed", "error", err)
		os.Exit(1)
	}
	logger.Info(serviceName + " stopped")
}

func run(logger *slog.Logger) error {
	_ = godotenv.Load()

	dbURL := env.Or("DATABASE_URL", defaultDatabaseURL)
	amqpURL := env.Or("RABBITMQ_URL", defaultRabbitMQURL)
	interval := env.DurationOr("CRON_INTERVAL", defaultInterval)

	startupCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := pgxpool.New(startupCtx, dbURL)
	if err != nil {
		return fmt.Errorf("connect to postgres: %w", err)
	}
	defer pool.Close()

	if err := pool.Ping(startupCtx); err != nil {
		return fmt.Errorf("ping postgres: %w", err)
	}

	conn, err := rabbitmq.Connect(amqpURL)
	if err != nil {
		return err
	}
	defer conn.Close()

	ch, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("create channel: %w", err)
	}
	defer ch.Close()

	publisher, err := events.NewPublisher(ch, events.WithLogger(logger))
	if err != nil {
		return fmt.Errorf("create publisher: %w", err)
	}

	store := expedition.NewPgStore(pool)
	outboxDrainer := events.NewOutboxDrainer(func(ctx context.Context) (events.OutboxBatch, error) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return nil, err
		}
		return expedition.NewOutboxBatch(tx), nil
	}, publisher, logger)
	worker := expedition.NewResolutionWorker(store, outboxDrainer, expedition.WithLogger(logger))

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Run immediately so a restarted worker catches up on every expedition
	// whose resolve_at already passed without waiting for the first tick.
	if err := worker.Tick(startupCtx); err != nil {
		return fmt.Errorf("initial tick: %w", err)
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sig)

	for {
		select {
		case <-ticker.C:
			// Use a fresh context per tick so a slow database query does not
			// accumulate deadline pressure across ticks.
			tickCtx, cancel := context.WithTimeout(context.Background(), interval)
			if err := worker.Tick(tickCtx); err != nil {
				logger.Error("tick failed", "error", err)
			}
			cancel()
		case s := <-sig:
			logger.Info(serviceName+": shutting down", "signal", s.String())
			return nil
		}
	}
}
