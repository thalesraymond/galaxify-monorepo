package expedition

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/pkg/timestamptz"
	"github.com/thalesraymond/galaxify-monorepo/workers/expedition-worker/internal/database"
)

// Tx is the database surface used inside an expedition resolution transaction.
type Tx interface {
	ListPendingExpeditions(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpeditionsRow, error)
	ResolveExpedition(ctx context.Context, id pgtype.UUID, status string, now time.Time) error
	InsertExpeditionResult(ctx context.Context, expeditionID pgtype.UUID, outcome string, rewardSummary []byte) error
	InsertOutbox(ctx context.Context, arg database.InsertOutboxParams) error
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

func (t *pgTx) ListPendingExpeditions(ctx context.Context, before time.Time, limit int32) ([]database.ListPendingExpeditionsRow, error) {
	rows, err := t.q.ListPendingExpeditions(ctx, database.ListPendingExpeditionsParams{
		Before:    timestamptz.FromTime(before),
		BatchSize: limit,
	})
	if err != nil {
		return nil, fmt.Errorf("list pending expeditions: %w", err)
	}
	return rows, nil
}

func (t *pgTx) ResolveExpedition(ctx context.Context, id pgtype.UUID, status string, now time.Time) error {
	if err := t.q.ResolveExpedition(ctx, database.ResolveExpeditionParams{
		Status: status,
		Now:    timestamptz.FromTime(now),
		ID:     id,
	}); err != nil {
		return fmt.Errorf("resolve expedition %v as %s: %w", id, status, err)
	}
	return nil
}

func (t *pgTx) InsertExpeditionResult(ctx context.Context, expeditionID pgtype.UUID, outcome string, rewardSummary []byte) error {
	if err := t.q.InsertExpeditionResult(ctx, database.InsertExpeditionResultParams{
		ExpeditionID:  expeditionID,
		Outcome:       outcome,
		RewardSummary: rewardSummary,
	}); err != nil {
		return fmt.Errorf("insert expedition result for %v: %w", expeditionID, err)
	}
	return nil
}

func (t *pgTx) InsertOutbox(ctx context.Context, arg database.InsertOutboxParams) error {
	if err := t.q.InsertOutbox(ctx, arg); err != nil {
		return fmt.Errorf("insert %q outbox event: %w", arg.EventType, err)
	}
	return nil
}
