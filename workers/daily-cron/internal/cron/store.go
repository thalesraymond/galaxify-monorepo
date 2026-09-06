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
	RollOverPendingDaily(ctx context.Context, daily database.ListPendingExpiredDailiesRow, now time.Time) error
	ListCompletedExpiredDailies(ctx context.Context, before time.Time, limit int32) ([]pgtype.UUID, error)
	ResetCompletedDaily(ctx context.Context, id pgtype.UUID, now time.Time) error
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

func (t *pgTx) RollOverPendingDaily(ctx context.Context, daily database.ListPendingExpiredDailiesRow, now time.Time) error {
	nowTz := toTimestamptz(now)
	if err := t.q.CreateDailyHistory(ctx, database.CreateDailyHistoryParams{
		DailyID:     daily.ID,
		UserID:      daily.UserID,
		Title:       daily.Title,
		Description: daily.Description,
		Difficulty:  daily.Difficulty,
		DueDate:     daily.DueDate,
		MissedAt:    nowTz,
	}); err != nil {
		return fmt.Errorf("create daily history for %v: %w", daily.ID, err)
	}
	if err := t.q.RollOverPendingDaily(ctx, database.RollOverPendingDailyParams{
		Now: nowTz,
		ID:  daily.ID,
	}); err != nil {
		return fmt.Errorf("roll over pending daily %v: %w", daily.ID, err)
	}
	return nil
}

func (t *pgTx) ListCompletedExpiredDailies(ctx context.Context, before time.Time, limit int32) ([]pgtype.UUID, error) {
	rows, err := t.q.ListCompletedExpiredDailies(ctx, database.ListCompletedExpiredDailiesParams{
		Before:    toTimestamptz(before),
		BatchSize: limit,
	})
	if err != nil {
		return nil, fmt.Errorf("list completed expired dailies: %w", err)
	}
	return rows, nil
}

func (t *pgTx) ResetCompletedDaily(ctx context.Context, id pgtype.UUID, now time.Time) error {
	if err := t.q.ResetCompletedDaily(ctx, database.ResetCompletedDailyParams{
		Now: toTimestamptz(now),
		ID:  id,
	}); err != nil {
		return fmt.Errorf("reset completed daily %v: %w", id, err)
	}
	return nil
}
