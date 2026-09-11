package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/consumer"
	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/handler"
	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/ship"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/rabbitmq"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

const serviceName = "ship-service"

// Defaults match docker-compose.yml so the service runs against local
// infrastructure even without a .env file. .env overrides them.
const (
	defaultDatabaseURL = "postgres://postgres:password@localhost:5433/ship_db"
	defaultRabbitMQURL = "amqp://guest:guest@localhost:5672/"
	defaultHTTPAddr    = ":8083"
	defaultJWKSURL     = "http://localhost:8081/.well-known/jwks.json"
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
	jwksURL := envOr("JWKS_URL", defaultJWKSURL)

	timeoutCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Long-lived context for the event subscriber. The startup ctx above has a
	// 15s timeout and must NOT be reused for handlers — it expires shortly
	// after boot, so every handler would fail with "context deadline exceeded".
	subCtx, subCancel := context.WithCancel(context.Background())
	defer subCancel()

	pool, err := pgxpool.New(timeoutCtx, dbURL)
	if err != nil {
		return fmt.Errorf("connect to postgres: %w", err)
	}
	defer pool.Close()

	if err := pool.Ping(timeoutCtx); err != nil {
		return fmt.Errorf("ping postgres: %w", err)
	}

	conn, err := rabbitmq.Connect(amqpURL)
	if err != nil {
		return err
	}
	defer conn.Close()

	subscriberChannel, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("create subscriber channel: %w", err)
	}

	subscriber, err := events.NewSubscriber(subscriberChannel, serviceName, events.WithLogger(logger))
	if err != nil {
		return fmt.Errorf("create subscriber: %w", err)
	}

	idempotencyStoreFactory := func(tx pgx.Tx) events.IdempotencyStore { return database.New(tx) }
	publisherChannel, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("create publisher channel: %w", err)
	}
	eventPublisher, err := events.NewPublisher(publisherChannel, events.WithLogger(logger))
	if err != nil {
		return fmt.Errorf("create event publisher: %w", err)
	}
	defer func() {
		if err := eventPublisher.Close(); err != nil {
			logger.Error("close event publisher", "error", err)
		}
	}()

	subscriber.On("user.created", consumer.NewUserCreatedHandler(
		pool,
		idempotencyStoreFactory,
		events.WithLogger(logger),
	))
	subscriber.On("daily.completed", consumer.NewDailyCompletedHandler(
		pool,
		idempotencyStoreFactory,
		events.WithLogger(logger),
	))
	subscriber.On("daily.missed", consumer.NewDailyMissedHandler(
		pool,
		idempotencyStoreFactory,
		events.WithLogger(logger),
	))
	subscriber.On("expedition.launched", consumer.NewExpeditionLaunchedHandler(
		pool,
		idempotencyStoreFactory,
		events.WithLogger(logger),
	))
	subscriber.On("expedition.completed", consumer.NewExpeditionCompletedHandler(
		pool,
		idempotencyStoreFactory,
		events.WithLogger(logger),
	))

	if err := subscriber.Start(subCtx); err != nil {
		return fmt.Errorf("start subscriber: %w", err)
	}

	logger.Info(serviceName + ": connected to PostgreSQL and RabbitMQ")

	jwksCache := auth.NewSimpleJWKSCache(jwksURL)
	if err := jwksCache.ForceRefresh(timeoutCtx); err != nil {
		return fmt.Errorf("warm JWKS cache: %w", err)
	}
	authHandshake := sharedhttp.NewAuthHandshake(jwksCache)

	mux := http.NewServeMux()
	handler.NewHealthHandler(serviceName).RegisterHealthRoutes(mux)
	shipManager := ship.NewManager(
		database.New(pool),
		pool,
		func(tx pgx.Tx) ship.Store { return database.New(tx) },
	)
	handler.NewShipHandler(shipManager, authHandshake, logger).RegisterShipRoutes(mux)

	outboxDrainer := events.NewOutboxDrainer(func(ctx context.Context) (events.OutboxBatch, error) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return nil, err
		}
		return ship.NewOutboxBatch(tx), nil
	}, eventPublisher, logger)

	srv := &http.Server{
		Addr:    httpAddr,
		Handler: sharedhttp.RequestIDMiddleware(outboxDrainer.DrainAfterRequest(mux, 50)),
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
		if err := subscriber.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("subscriber shutdown: %w", err)
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
