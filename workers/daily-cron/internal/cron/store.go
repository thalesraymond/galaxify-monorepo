package cron

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// DailyRow is the subset of the dailies table the worker needs.
type DailyRow struct {
	ID         pgtype.UUID
	UserID     pgtype.UUID
	Difficulty string
}

// OutboxRow is one pending row from the outbox table.
type OutboxRow struct {
	ID        int64
	EventID   pgtype.UUID
	EventType string
	Payload   []byte
}

// Tx is the database surface used inside a missed-daily transaction.
type Tx interface {
	ListPendingExpiredDailies(ctx context.Context, before time.Time, limit int32) ([]DailyRow, error)
	GetDamageAmount(ctx context.Context, difficulty string) (int32, error)
	MarkDailyMissed(ctx context.Context, dailyID pgtype.UUID) error
	InsertOutbox(ctx context.Context, eventID pgtype.UUID, eventType string, payload []byte) error
	ListPendingOutbox(ctx context.Context, limit int32) ([]OutboxRow, error)
	MarkOutboxPublished(ctx context.Context, id int64) error
}

// Store abstracts transaction management and outbox draining for the worker.
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

	if err := fn(&pgTx{tx: tx}); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}

type pgTx struct {
	tx pgx.Tx
}

func (t *pgTx) ListPendingExpiredDailies(ctx context.Context, before time.Time, limit int32) ([]DailyRow, error) {
	rows, err := t.tx.Query(ctx, `
		SELECT id, user_id, difficulty
		FROM dailies
		WHERE status = 'PENDING' AND due_date < $1
		ORDER BY due_date ASC
		LIMIT $2
		FOR UPDATE SKIP LOCKED
	`, before, limit)
	if err != nil {
		return nil, fmt.Errorf("list pending expired dailies: %w", err)
	}
	defer rows.Close()

	var dailies []DailyRow
	for rows.Next() {
		var d DailyRow
		if err := rows.Scan(&d.ID, &d.UserID, &d.Difficulty); err != nil {
			return nil, fmt.Errorf("scan pending daily: %w", err)
		}
		dailies = append(dailies, d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pending dailies: %w", err)
	}
	return dailies, nil
}

func (t *pgTx) GetDamageAmount(ctx context.Context, difficulty string) (int32, error) {
	row := t.tx.QueryRow(ctx, `
		SELECT damage_amount FROM difficulty_rewards WHERE difficulty = $1
	`, difficulty)
	var damage int32
	if err := row.Scan(&damage); err != nil {
		return 0, fmt.Errorf("get damage amount for %q: %w", difficulty, err)
	}
	return damage, nil
}

func (t *pgTx) MarkDailyMissed(ctx context.Context, dailyID pgtype.UUID) error {
	_, err := t.tx.Exec(ctx, `
		UPDATE dailies
		SET status = 'MISSED', updated_at = now()
		WHERE id = $1 AND status = 'PENDING'
	`, dailyID)
	if err != nil {
		return fmt.Errorf("mark daily missed: %w", err)
	}
	return nil
}

func (t *pgTx) InsertOutbox(ctx context.Context, eventID pgtype.UUID, eventType string, payload []byte) error {
	_, err := t.tx.Exec(ctx, `
		INSERT INTO outbox (event_id, event_type, payload)
		VALUES ($1, $2, $3)
	`, eventID, eventType, payload)
	if err != nil {
		return fmt.Errorf("insert outbox row: %w", err)
	}
	return nil
}

func (t *pgTx) ListPendingOutbox(ctx context.Context, limit int32) ([]OutboxRow, error) {
	rows, err := t.tx.Query(ctx, `
		SELECT id, event_id, event_type, payload
		FROM outbox
		WHERE status = 'PENDING'
		ORDER BY created_at ASC
		LIMIT $1
		FOR UPDATE SKIP LOCKED
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("list pending outbox: %w", err)
	}
	defer rows.Close()

	var outbox []OutboxRow
	for rows.Next() {
		var o OutboxRow
		if err := rows.Scan(&o.ID, &o.EventID, &o.EventType, &o.Payload); err != nil {
			return nil, fmt.Errorf("scan outbox row: %w", err)
		}
		outbox = append(outbox, o)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pending outbox: %w", err)
	}
	return outbox, nil
}

func (t *pgTx) MarkOutboxPublished(ctx context.Context, id int64) error {
	_, err := t.tx.Exec(ctx, `
		UPDATE outbox
		SET status = 'PUBLISHED', published_at = now()
		WHERE id = $1
	`, id)
	if err != nil {
		return fmt.Errorf("mark outbox published: %w", err)
	}
	return nil
}
