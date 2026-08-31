package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/rabbitmq"
)

const serviceName = "daily-service"

// Defaults match docker-compose.yml so the service runs against local
// infrastructure even without a .env file. .env overrides them.
const (
	defaultDatabaseURL = "postgres://postgres:password@localhost:5432/daily_db"
	defaultRabbitMQURL = "amqp://guest:guest@localhost:5672/"
	defaultHTTPAddr    = ":8082"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	if err := run(logger); err != nil {
		logger.Error(serviceName+" failed", "error", err)
		os.Exit(1)
	}
	logger.Info(serviceName + " stopped")
}

// run wires the service together and serves HTTP until it receives a
// SIGINT/SIGTERM, then shuts down gracefully.
func run(logger *slog.Logger) error {
	_ = godotenv.Load()

	dbURL := envOr("DATABASE_URL", defaultDatabaseURL)
	amqpURL := envOr("RABBITMQ_URL", defaultRabbitMQURL)
	httpAddr := envOr("HTTP_ADDR", defaultHTTPAddr)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		return fmt.Errorf("connect to postgres: %w", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping postgres: %w", err)
	}

	db := database.New(pool)

	conn, err := rabbitmq.Connect(amqpURL)
	if err != nil {
		return err
	}
	defer conn.Close()

	// TODO: REMOVE THIS TEST BEFORE DEPLOYMENT. This is just to test the subscriber.
	subscriber, err := events.NewSubscriber(conn, "daily-service")
	if err != nil {
		return fmt.Errorf("create subscriber: %w", err)
	}

	subscriber.On("user.created", events.HandlerFunc(func(ctx context.Context, eventType string, payload []byte) error {
		var envelope events.Envelope
		if err := json.Unmarshal(payload, &envelope); err != nil {
			return fmt.Errorf("unmarshal envelope: %w", err)
		}

		idempotency := events.NewProcessedEvents(db)

		logger.Info("Received user.created event", "event_id", envelope.EventId, "payload", string(payload))

		should_process, err := idempotency.MarkProcessed(ctx, envelope.EventId)
		if err != nil {
			return err
		}

		if should_process {
			logger.Info("Processing event", "event_id", envelope.EventId)
		} else {
			logger.Info("Event already processed, skipping", "event_id", envelope.EventId)
			return nil
		}
		return nil
	}))

	if err := subscriber.Start(ctx); err != nil {
		return fmt.Errorf("start subscriber: %w", err)
	}
	// END TEST

	srv := &http.Server{
		Addr:    httpAddr,
		Handler: NewHealthHandler(),
	}

	serveErr := make(chan error, 1)
	go func() {
		logger.Info(serviceName+": serving HTTP", "addr", httpAddr)
		serveErr <- srv.ListenAndServe()
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sig)

	select {
	case err := <-serveErr:
		if !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("http server: %w", err)
		}
		return nil
	case s := <-sig:
		logger.Info(serviceName+": shutting down", "signal", s.String())
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("graceful shutdown: %w", err)
		}
		return nil
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
