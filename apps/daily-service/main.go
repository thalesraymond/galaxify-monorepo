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
	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/consumer"
	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/daily"
	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/handler"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/rabbitmq"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

const serviceName = "daily-service"

// Defaults match docker-compose.yml so the service runs against local
// infrastructure even without a .env file. .env overrides them.
const (
	defaultDatabaseURL = "postgres://postgres:password@localhost:5432/daily_db"
	defaultRabbitMQURL = "amqp://guest:guest@localhost:5672/"
	defaultHTTPAddr    = ":8082"
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

	db := database.New(pool)

	conn, err := rabbitmq.Connect(amqpURL)
	if err != nil {
		return err
	}
	defer conn.Close()

	ch, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("create channel: %w", err)
	}

	subscriber, err := events.NewSubscriber(ch, "daily-service")
	if err != nil {
		return fmt.Errorf("create subscriber: %w", err)
	}

	subscriber.On("user.created", events.NewIdempotentHandler(
		pool,
		func(tx pgx.Tx) events.IdempotencyStore { return database.New(tx) },
		consumer.HandleUserCreated,
		events.WithLogger(logger),
	))
	subscriber.On("user.deleted", events.NewIdempotentHandler(
		pool,
		func(tx pgx.Tx) events.IdempotencyStore { return database.New(tx) },
		consumer.HandleUserDeleted,
		events.WithLogger(logger),
	))

	if err := subscriber.Start(subCtx); err != nil {
		return fmt.Errorf("start subscriber: %w", err)
	}

	mux := http.NewServeMux()
	handler.NewHealthHandler(serviceName).RegisterHealthRoutes(mux)

	jwksCache := auth.NewSimpleJWKSCache(jwksURL)
	// Warm the JWKS cache at startup so the first authenticated request doesn't
	// have to hit the unknown-kid fallback path. SimpleJWKSCache starts empty;
	// ForceRefresh populates it from user-service's JWKS endpoint. If user-service
	// is unreachable here, fail boot loudly rather than failing the first request.
	if err := jwksCache.ForceRefresh(timeoutCtx); err != nil {
		return fmt.Errorf("warm jwks cache: %w", err)
	}

	authHandshake := sharedhttp.NewAuthHandshake(jwksCache)

	publisher, err := events.NewPublisher(ch, events.WithLogger(logger))
	if err != nil {
		return fmt.Errorf("create publisher: %w", err)
	}

	dailyManager := daily.NewDailyManager(
		pool,
		func(tx pgx.Tx) daily.Store { return database.New(tx) },
		db,
		publisher,
		daily.WithDailyManagerLogger(logger),
	)

	dailyHandler := handler.NewDailyHandler(dailyManager, authHandshake, logger)
	dailyHandler.RegisterDailyRoutes(mux)

	srv := &http.Server{
		Addr:    httpAddr,
		Handler: sharedhttp.RequestIDMiddleware(mux),
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
		// Stop consuming and wait for in-flight event handlers to finish.
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
