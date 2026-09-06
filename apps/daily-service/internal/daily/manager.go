package daily

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
)

// TxStarter abstracts opening database transactions.
// *pgxpool.Pool satisfies TxStarter directly in production.
type TxStarter interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// EventPublisher is the narrow interface for publishing domain events.
type EventPublisher interface {
	Publish(ctx context.Context, eventType string, payload any, opts ...events.PublishOption) error
}

// Store is the internal database surface required by DailyManager.
// *database.Queries satisfies this interface directly.
type Store interface {
	CreateDaily(ctx context.Context, arg database.CreateDailyParams) (database.Daily, error)
	ListDailies(ctx context.Context, arg database.ListDailiesParams) ([]database.Daily, error)
	GetDaily(ctx context.Context, arg database.GetDailyParams) (database.Daily, error)
	UpdateDaily(ctx context.Context, arg database.UpdateDailyParams) (database.Daily, error)
	DeleteDaily(ctx context.Context, arg database.DeleteDailyParams) (int64, error)
	MarkDailyComplete(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error)
	GetDifficultyReward(ctx context.Context, difficulty string) (database.DifficultyReward, error)
}

// Manager defines the high-leverage domain interface for the Daily Task Lifecycle.
type Manager interface {
	Create(ctx context.Context, input CreateInput) (Daily, error)
	Get(ctx context.Context, userID, id uuid.UUID) (Daily, error)
	List(ctx context.Context, userID uuid.UUID, filter ListFilter) ([]Daily, error)
	Update(ctx context.Context, userID, id uuid.UUID, input UpdateInput) (Daily, error)
	Delete(ctx context.Context, userID, id uuid.UUID) error
	Complete(ctx context.Context, userID, id uuid.UUID) (Daily, error)
}

// DailyManager implements Manager.
type DailyManager struct {
	pool         TxStarter
	storeFactory func(tx pgx.Tx) Store
	baseStore    Store
	publisher    EventPublisher
	logger       *slog.Logger
}

// Option configures DailyManager.
type Option func(*DailyManager)

// WithLogger sets the logger for DailyManager.
func WithLogger(logger *slog.Logger) Option {
	return func(m *DailyManager) {
		if logger != nil {
			m.logger = logger
		}
	}
}

// NewDailyManager creates a DailyManager.
func NewDailyManager(
	pool TxStarter,
	storeFactory func(tx pgx.Tx) Store,
	baseStore Store,
	publisher EventPublisher,
	opts ...Option,
) *DailyManager {
	m := &DailyManager{
		pool:         pool,
		storeFactory: storeFactory,
		baseStore:    baseStore,
		publisher:    publisher,
		logger:       slog.Default(),
	}
	for _, opt := range opts {
		opt(m)
	}
	return m
}

// Create stores a new daily task for the user.
func (m *DailyManager) Create(ctx context.Context, input CreateInput) (Daily, error) {
	if !IsValidDifficulty(input.Difficulty) {
		return Daily{}, ErrInvalidDifficulty
	}

	pgUserID := pgtype.UUID{Bytes: input.UserID, Valid: true}
	row, err := m.baseStore.CreateDaily(ctx, database.CreateDailyParams{
		UserID:      pgUserID,
		Title:       input.Title,
		Description: input.Description,
		Difficulty:  string(input.Difficulty),
		DueDate:     pgtype.Timestamptz{Time: input.DueDate, Valid: true},
	})
	if err != nil {
		return Daily{}, fmt.Errorf("create daily: %w", err)
	}
	return toDomainDaily(row), nil
}

// Get retrieves a single daily owned by the user.
func (m *DailyManager) Get(ctx context.Context, userID, id uuid.UUID) (Daily, error) {
	row, err := m.baseStore.GetDaily(ctx, database.GetDailyParams{
		ID:     pgtype.UUID{Bytes: id, Valid: true},
		UserID: pgtype.UUID{Bytes: userID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Daily{}, ErrDailyNotFound
		}
		return Daily{}, fmt.Errorf("get daily: %w", err)
	}
	return toDomainDaily(row), nil
}

// List returns all dailies for the user, optionally filtered by status and date, ordered by due_date and created_at.
func (m *DailyManager) List(ctx context.Context, userID uuid.UUID, filter ListFilter) ([]Daily, error) {
	params := database.ListDailiesParams{
		UserID: pgtype.UUID{Bytes: userID, Valid: true},
	}
	if filter.Status != nil {
		params.Status = pgtype.Text{String: string(*filter.Status), Valid: true}
	}
	if filter.Date != nil {
		params.DueDate = pgtype.Date{Time: *filter.Date, Valid: true}
	}

	rows, err := m.baseStore.ListDailies(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("list dailies: %w", err)
	}
	dailies := make([]Daily, len(rows))
	for i, r := range rows {
		dailies[i] = toDomainDaily(r)
	}
	return dailies, nil
}

// Update mutates fields of a pending daily task atomically.
func (m *DailyManager) Update(ctx context.Context, userID, id uuid.UUID, input UpdateInput) (Daily, error) {
	if input.Difficulty != nil && !IsValidDifficulty(*input.Difficulty) {
		return Daily{}, ErrInvalidDifficulty
	}

	tx, err := m.pool.Begin(ctx)
	if err != nil {
		return Daily{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	s := m.storeFactory(tx)
	pgUserID := pgtype.UUID{Bytes: userID, Valid: true}
	pgDailyID := pgtype.UUID{Bytes: id, Valid: true}

	params := database.UpdateDailyParams{
		ID:     pgDailyID,
		UserID: pgUserID,
	}
	if input.Title != nil {
		params.Title = pgtype.Text{String: *input.Title, Valid: true}
	}
	if input.Description != nil {
		params.Description = pgtype.Text{String: *input.Description, Valid: true}
	}
	if input.Difficulty != nil {
		params.Difficulty = pgtype.Text{String: string(*input.Difficulty), Valid: true}
	}
	if input.DueDate != nil {
		params.DueDate = pgtype.Timestamptz{Time: *input.DueDate, Valid: true}
	}

	updatedRow, err := s.UpdateDaily(ctx, params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			existing, getErr := s.GetDaily(ctx, database.GetDailyParams{
				ID:     pgDailyID,
				UserID: pgUserID,
			})
			if getErr != nil {
				if errors.Is(getErr, pgx.ErrNoRows) {
					return Daily{}, ErrDailyNotFound
				}
				return Daily{}, fmt.Errorf("get daily: %w", getErr)
			}
			if existing.Status != "PENDING" {
				return Daily{}, ErrDailyNotPending
			}
		}
		return Daily{}, fmt.Errorf("update daily: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Daily{}, fmt.Errorf("commit tx: %w", err)
	}

	return toDomainDaily(updatedRow), nil
}

// Delete removes a pending daily task atomically.
func (m *DailyManager) Delete(ctx context.Context, userID, id uuid.UUID) error {
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	s := m.storeFactory(tx)
	pgUserID := pgtype.UUID{Bytes: userID, Valid: true}
	pgDailyID := pgtype.UUID{Bytes: id, Valid: true}

	rowsAffected, err := s.DeleteDaily(ctx, database.DeleteDailyParams{
		ID:     pgDailyID,
		UserID: pgUserID,
	})
	if err != nil {
		return fmt.Errorf("delete daily: %w", err)
	}
	if rowsAffected == 0 {
		existing, getErr := s.GetDaily(ctx, database.GetDailyParams{
			ID:     pgDailyID,
			UserID: pgUserID,
		})
		if getErr != nil {
			if errors.Is(getErr, pgx.ErrNoRows) {
				return ErrDailyNotFound
			}
			return fmt.Errorf("get daily: %w", getErr)
		}
		if existing.Status != string(StatusPending) {
			return ErrDailyNotPending
		}
		return fmt.Errorf("delete daily: 0 rows affected")
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}

	return nil
}

// Complete atomically marks a pending daily as COMPLETED, fetches difficulty reward materials,
// and publishes the daily.completed event.
func (m *DailyManager) Complete(ctx context.Context, userID, id uuid.UUID) (Daily, error) {
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		return Daily{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	s := m.storeFactory(tx)
	pgUserID := pgtype.UUID{Bytes: userID, Valid: true}
	pgDailyID := pgtype.UUID{Bytes: id, Valid: true}

	completedRow, err := s.MarkDailyComplete(ctx, database.MarkDailyCompleteParams{
		ID:     pgDailyID,
		UserID: pgUserID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			existing, getErr := s.GetDaily(ctx, database.GetDailyParams{
				ID:     pgDailyID,
				UserID: pgUserID,
			})
			if getErr != nil {
				if errors.Is(getErr, pgx.ErrNoRows) {
					return Daily{}, ErrDailyNotFound
				}
				return Daily{}, fmt.Errorf("get daily: %w", getErr)
			}
			if existing.Status == string(StatusCompleted) {
				return Daily{}, ErrDailyAlreadyCompleted
			}
			if existing.Status != string(StatusPending) {
				return Daily{}, ErrDailyNotPending
			}
		}
		return Daily{}, fmt.Errorf("mark daily complete: %w", err)
	}

	reward, err := s.GetDifficultyReward(ctx, completedRow.Difficulty)
	if err != nil {
		return Daily{}, fmt.Errorf("get difficulty reward: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Daily{}, fmt.Errorf("commit tx: %w", err)
	}

	if m.publisher != nil {
		if err := m.publisher.Publish(ctx, "daily.completed", events.DailyCompleted{
			Version:         1,
			UserID:          userID.String(),
			DailyID:         id.String(),
			Difficulty:      completedRow.Difficulty,
			RewardMaterials: int(reward.RewardMaterials),
		}); err != nil {
			return toDomainDaily(completedRow), fmt.Errorf("publish daily.completed: %w", err)
		}
	}

	return toDomainDaily(completedRow), nil
}

func toDomainDaily(row database.Daily) Daily {
	var id, userID uuid.UUID
	if row.ID.Valid {
		id = row.ID.Bytes
	}
	if row.UserID.Valid {
		userID = row.UserID.Bytes
	}
	var dueDate, createdAt, updatedAt time.Time
	if row.DueDate.Valid {
		dueDate = row.DueDate.Time
	}
	if row.CreatedAt.Valid {
		createdAt = row.CreatedAt.Time
	}
	if row.UpdatedAt.Valid {
		updatedAt = row.UpdatedAt.Time
	}
	return Daily{
		ID:          id,
		UserID:      userID,
		Title:       row.Title,
		Description: row.Description,
		Difficulty:  Difficulty(row.Difficulty),
		DueDate:     dueDate,
		Status:      Status(row.Status),
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
	}
}
