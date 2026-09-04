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

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/handler"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/rabbitmq"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

const serviceName = "user-service"

// Defaults match docker-compose.yml so the service runs against local
// infrastructure even without a .env file. .env overrides them.
const (
	defaultDatabaseURL = "postgres://postgres:password@localhost:5431/user_db"
	defaultRabbitMQURL = "amqp://guest:guest@localhost:5672/"
	defaultHTTPAddr    = ":8081"
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

	ch, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("create channel: %w", err)
	}

	publisher, err := events.NewPublisher(ch) // Initialize the publisher

	if err != nil {
		return fmt.Errorf("create publisher: %w", err)
	}

	defer publisher.Close()

	// TODO: REMOVE THIS TEST BEFORE DEPLOYMENT. This is just to test the publisher.
	publisher.Publish(subCtx, "user.created", events.UserCreated{
		Version:  1,
		UserID:   "123e4567-e89b-12d3-a456-426614174000",
		Email:    "test@test.com",
		Username: "testuser",
	})
	// END OF TEST
	logger.Info(serviceName + ": connected to PostgreSQL and RabbitMQ")

	mux := http.NewServeMux()

	healthHandler := handler.NewHealthHandler(serviceName)
	healthHandler.RegisterHealthRoutes(mux)

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
		return nil
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
