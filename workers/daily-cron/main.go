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

	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/rabbitmq"
	"github.com/thalesraymond/galaxify-monorepo/workers/daily-cron/internal/cron"
)

const serviceName = "daily-cron"

// Defaults match docker-compose.yml so the worker runs against local
// infrastructure even without a .env file. .env overrides them.
const (
	defaultDatabaseURL = "postgres://postgres:password@localhost:5432/daily_db"
	defaultRabbitMQURL = "amqp://guest:guest@localhost:5672/"
	defaultInterval    = 5 * time.Minute
)

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

	dbURL := envOr("DATABASE_URL", defaultDatabaseURL)
	amqpURL := envOr("RABBITMQ_URL", defaultRabbitMQURL)
	interval := envDurationOr("CRON_INTERVAL", defaultInterval)

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

	store := cron.NewPgStore(pool)
	worker := cron.NewWorker(store, publisher, cron.WithLogger(logger))

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Run immediately so a restarted worker catches up without waiting for the
	// first tick.
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

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envDurationOr(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return fallback
		}
		return d
	}
	return fallback
}
