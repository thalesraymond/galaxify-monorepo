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
	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/consumer"
	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/expedition"
	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/handler"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/rabbitmq"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

const serviceName = "expedition-service"

// Defaults match docker-compose.yml so the service runs against local
// infrastructure even without a .env file. .env overrides them.
const (
	defaultDatabaseURL = "postgres://postgres:password@localhost:5434/expedition_db"
	defaultRabbitMQURL = "amqp://guest:guest@localhost:5672/"
	defaultHTTPAddr    = ":8084"
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
	// 15s timeout and must not be reused for handlers — it expires shortly
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

	publisherChannel, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("create publisher channel: %w", err)
	}

	// NewPublisher declares galaxify.events and its alternate-exchange safety net.
	publisher, err := events.NewPublisher(publisherChannel, events.WithLogger(logger))
	if err != nil {
		return fmt.Errorf("declare event topology: %w", err)
	}
	defer func() {
		if err := publisher.Close(); err != nil {
			logger.Error("close event publisher", "error", err)
		}
	}()

	subscriberChannel, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("create subscriber channel: %w", err)
	}
	subscriber, err := events.NewSubscriber(subscriberChannel, serviceName, events.WithLogger(logger))
	if err != nil {
		return fmt.Errorf("create subscriber: %w", err)
	}
	idempotencyStoreFactory := func(tx pgx.Tx) events.IdempotencyStore { return database.New(tx) }
	subscriber.On("ship.status_updated", consumer.NewShipStatusUpdatedHandler(
		pool,
		idempotencyStoreFactory,
		events.WithLogger(logger),
	))
	subscriber.On("user.created", consumer.NewUserCreatedHandler(
		pool,
		idempotencyStoreFactory,
		events.WithLogger(logger),
	))
	if err := subscriber.Start(subCtx); err != nil {
		return fmt.Errorf("start subscriber: %w", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := subscriber.Shutdown(shutdownCtx); err != nil {
			logger.Error("shutdown subscriber", "error", err)
		}
	}()

	logger.Info(serviceName + ": connected to PostgreSQL and RabbitMQ")
	jwksCache := auth.NewSimpleJWKSCache(jwksURL)
	if err := jwksCache.ForceRefresh(timeoutCtx); err != nil {
		return fmt.Errorf("warm JWKS cache: %w", err)
	}
	authHandshake := sharedhttp.NewAuthHandshake(jwksCache)

	mux := http.NewServeMux()
	handler.NewHealthHandler(serviceName).RegisterHealthRoutes(mux)
	queries := database.New(pool)
	launchStoreFactory := func(tx pgx.Tx) expedition.LaunchStore { return database.New(tx) }
	expeditionManager := expedition.NewManager(queries, pool, launchStoreFactory)
	handler.NewExpeditionReadHandler(expeditionManager, authHandshake, logger).RegisterExpeditionReadRoutes(mux)
	outboxDrainer := events.NewOutboxDrainer(func(ctx context.Context) (events.OutboxBatch, error) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return nil, err
		}
		return expedition.NewOutboxBatch(tx), nil
	}, publisher, logger)
	handler.NewExpeditionLaunchHandler(expeditionManager, authHandshake, logger).RegisterExpeditionLaunchRoutes(mux)

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
		return nil
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
