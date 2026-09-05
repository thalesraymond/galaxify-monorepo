package cron

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/workers/daily-cron/internal/database"
)

// Tx is the database surface used inside a missed-daily transaction.
type Tx interface {
	ListPendingExpiredDailies(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpiredDailiesRow, error)
	GetDamageAmount(ctx context.Context, difficulty string) (int32, error)
	MarkDailyMissed(ctx context.Context, dailyID pgtype.UUID) error
}

// Store abstracts transaction management for the worker.
type Store interface {
	WithTx(ctx context.Context, fn func(Tx) error) error
}

// Pool is the subset of *pgxpool.Pool the worker needs.
type Pool interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// PgStore is a Store backed by a pgx connection pool.
type PgStore struct {
	pool Pool
}

// NewPgStore creates a PgStore.
func NewPgStore(pool Pool) *PgStore {
	return &PgStore{pool: pool}
}

// WithTx begins a transaction, runs fn, and commits or rolls back.
func (s *PgStore) WithTx(ctx context.Context, fn func(Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	if err := fn(&pgTx{q: database.New(tx)}); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}

type pgTx struct {
	q *database.Queries
}

func (t *pgTx) ListPendingExpiredDailies(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpiredDailiesRow, error) {
	rows, err := t.q.ListPendingExpiredDailies(ctx, database.ListPendingExpiredDailiesParams{
		Before:    toTimestamptz(before),
		BatchSize: limit,
	})
	if err != nil {
		return nil, fmt.Errorf("list pending expired dailies: %w", err)
	}
	return rows, nil
}

func (t *pgTx) GetDamageAmount(ctx context.Context, difficulty string) (int32, error) {
	damage, err := t.q.GetDamageAmount(ctx, difficulty)
	if err != nil {
		return 0, fmt.Errorf("get damage amount for %q: %w", difficulty, err)
	}
	return damage, nil
}

func (t *pgTx) MarkDailyMissed(ctx context.Context, dailyID pgtype.UUID) error {
	if err := t.q.MarkDailyMissed(ctx, dailyID); err != nil {
		return fmt.Errorf("mark daily missed: %w", err)
	}
	return nil
}
