package daily

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

const dailyCompletedEventType = "daily.completed"

// TxStarter abstracts opening database transactions.
// *pgxpool.Pool satisfies TxStarter directly in production.
type TxStarter interface {
	Begin(ctx context.Context) (pgx.Tx, error)
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
	ListDifficultyRewards(ctx context.Context) ([]database.DifficultyReward, error)
	CreateDailyHistory(ctx context.Context, arg database.CreateDailyHistoryParams) error
	ListDailyHistory(ctx context.Context, arg database.ListDailyHistoryParams) ([]database.DailyHistory, error)
	InsertOutbox(ctx context.Context, arg database.InsertOutboxParams) error
	UserCacheExists(ctx context.Context, id pgtype.UUID) (bool, error)
}

// Manager defines the high-leverage domain interface for the Daily Task Lifecycle.
type Manager interface {
	Create(ctx context.Context, input CreateInput) (Daily, error)
	Get(ctx context.Context, userID, id uuid.UUID) (Daily, error)
	List(ctx context.Context, userID uuid.UUID, filter ListFilter) ([]Daily, error)
	ListHistory(ctx context.Context, userID uuid.UUID, query HistoryQuery) (HistoryPage, error)
	Update(ctx context.Context, userID, id uuid.UUID, input UpdateInput) (Daily, error)
	Delete(ctx context.Context, userID, id uuid.UUID) error
	Complete(ctx context.Context, userID, id uuid.UUID) (Completion, error)
	Difficulties(ctx context.Context) ([]DifficultyMetadata, error)
}

// DailyManager implements Manager.
type DailyManager struct {
	pool         TxStarter
	storeFactory func(tx pgx.Tx) Store
	baseStore    Store
	logger       *slog.Logger
	cursorCodec  historyCursorCodec
}

// DailyManagerOption configures DailyManager.
type DailyManagerOption func(*DailyManager)

// WithDailyManagerLogger sets the logger for DailyManager.
func WithDailyManagerLogger(logger *slog.Logger) DailyManagerOption {
	return func(m *DailyManager) {
		if logger != nil {
			m.logger = logger
		}
	}
}

// WithHistoryCursorSigningKey overrides the HMAC key used to sign and verify
// Daily History continuation tokens. Pass the deployment's HISTORY_CURSOR_SECRET;
// an empty key keeps the development fallback.
func WithHistoryCursorSigningKey(key []byte) DailyManagerOption {
	return func(m *DailyManager) {
		m.cursorCodec = newHistoryCursorCodec(key)
	}
}

// NewDailyManager creates a DailyManager.
func NewDailyManager(
	pool TxStarter,
	storeFactory func(tx pgx.Tx) Store,
	baseStore Store,
	opts ...DailyManagerOption,
) *DailyManager {
	m := &DailyManager{
		pool:         pool,
		storeFactory: storeFactory,
		baseStore:    baseStore,
		logger:       slog.Default(),
		cursorCodec:  defaultHistoryCursorCodec,
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
	if _, err := LoadTimeZone(input.TimeZone); err != nil {
		return Daily{}, ErrInvalidTimeZone
	}
	if err := validateContent(input.Title, input.Description); err != nil {
		return Daily{}, err
	}
	if err := ensurePlayerReady(ctx, m.baseStore, input.UserID); err != nil {
		return Daily{}, err
	}

	pgUserID := pgtype.UUID{Bytes: input.UserID, Valid: true}
	row, err := m.baseStore.CreateDaily(ctx, database.CreateDailyParams{
		UserID:      pgUserID,
		Title:       input.Title,
		Description: input.Description,
		Difficulty:  string(input.Difficulty),
		DueDate:     pgtype.Timestamptz{Time: input.DueDate, Valid: true},
		TimeZone:    input.TimeZone,
	})
	if err != nil {
		return Daily{}, fmt.Errorf("create daily: %w", err)
	}
	return toDomainDaily(row), nil
}

// Get retrieves a single daily owned by the user.
func (m *DailyManager) Get(ctx context.Context, userID, id uuid.UUID) (Daily, error) {
	if err := ensurePlayerReady(ctx, m.baseStore, userID); err != nil {
		return Daily{}, err
	}
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
	if err := ensurePlayerReady(ctx, m.baseStore, userID); err != nil {
		return nil, err
	}
	params := database.ListDailiesParams{
		UserID: pgtype.UUID{Bytes: userID, Valid: true},
	}
	if filter.Status != nil {
		params.Status = pgtype.Text{String: string(*filter.Status), Valid: true}
	}
	if filter.From != nil {
		params.From = pgtype.Timestamptz{Time: *filter.From, Valid: true}
	}
	if filter.To != nil {
		params.To = pgtype.Timestamptz{Time: *filter.To, Valid: true}
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

// DefaultHistoryPageSize is the page size used when a request does not specify
// one. MaxHistoryPageSize caps an explicit page size so a single read can never
// be unbounded.
const (
	DefaultHistoryPageSize = 20
	MaxHistoryPageSize     = 100
)

// ListHistory returns one stable, descending page of the user's daily history.
// Rows are ordered by (due_date, archived_at, id) desc; the tuple is unique
// because id is, so NextCursor continues strictly after the last item and a
// traversal neither duplicates nor omits entries. Concurrent newer inserts sort
// before the cursor and therefore cannot shift the already-observed sequence.
//
// A missing users_cache row means the Player's Daily state is still provisioning,
// so this read is retryable via ErrPlayerNotReady.
func (m *DailyManager) ListHistory(ctx context.Context, userID uuid.UUID, query HistoryQuery) (HistoryPage, error) {
	if err := ensurePlayerReady(ctx, m.baseStore, userID); err != nil {
		return HistoryPage{}, err
	}

	pageSize := normalizeHistoryPageSize(query.Limit)

	params := database.ListDailyHistoryParams{
		UserID:   pgtype.UUID{Bytes: userID, Valid: true},
		PageSize: int32(pageSize) + 1, // read one extra to detect a following page
	}
	if query.Cursor != "" {
		cursor, err := m.cursorCodec.decode(query.Cursor)
		if err != nil {
			return HistoryPage{}, err
		}
		params.CursorDueDate = pgtype.Timestamptz{Time: cursor.DueDate, Valid: true}
		params.CursorArchivedAt = pgtype.Timestamptz{Time: cursor.ArchivedAt, Valid: true}
		params.CursorID = pgtype.UUID{Bytes: cursor.ID, Valid: true}
	}

	rows, err := m.baseStore.ListDailyHistory(ctx, params)
	if err != nil {
		return HistoryPage{}, fmt.Errorf("list daily history: %w", err)
	}

	page := HistoryPage{Items: make([]DailyHistory, 0, pageSize)}
	if len(rows) > pageSize {
		rows = rows[:pageSize]
		last := rows[len(rows)-1]
		page.NextCursor = m.cursorCodec.encode(HistoryCursor{
			DueDate:    last.DueDate.Time,
			ArchivedAt: last.ArchivedAt.Time,
			ID:         last.ID.Bytes,
		})
	}
	for _, r := range rows {
		page.Items = append(page.Items, toDomainDailyHistory(r))
	}
	return page, nil
}

func normalizeHistoryPageSize(limit int) int {
	if limit <= 0 {
		return DefaultHistoryPageSize
	}
	if limit > MaxHistoryPageSize {
		return MaxHistoryPageSize
	}
	return limit
}

// Update mutates fields of a daily task atomically. Permitted even if the task is COMPLETED today.
func (m *DailyManager) Update(ctx context.Context, userID, id uuid.UUID, input UpdateInput) (Daily, error) {
	if input.Difficulty != nil && !IsValidDifficulty(*input.Difficulty) {
		return Daily{}, ErrInvalidDifficulty
	}
	if input.TimeZone != nil {
		if _, err := LoadTimeZone(*input.TimeZone); err != nil {
			return Daily{}, ErrInvalidTimeZone
		}
	}
	if input.Title != nil {
		if err := validateContent(*input.Title, ""); err != nil {
			return Daily{}, err
		}
	}
	if input.Description != nil {
		if err := validateContent("", *input.Description); err != nil {
			return Daily{}, err
		}
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
	if input.TimeZone != nil {
		params.TimeZone = pgtype.Text{String: *input.TimeZone, Valid: true}
	}

	updatedRow, err := s.UpdateDaily(ctx, params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Daily{}, ErrDailyNotFound
		}
		return Daily{}, fmt.Errorf("update daily: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Daily{}, fmt.Errorf("commit tx: %w", err)
	}

	return toDomainDaily(updatedRow), nil
}

// Delete removes a daily task atomically. Permitted even if the task is COMPLETED today.
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
		return ErrDailyNotFound
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}

	return nil
}

// Complete atomically marks a pending daily as COMPLETED, inserts into daily_history,
// fetches difficulty reward materials, and publishes the daily.completed event.
func (m *DailyManager) Complete(ctx context.Context, userID, id uuid.UUID) (Completion, error) {
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		return Completion{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	s := m.storeFactory(tx)
	if err := ensurePlayerReady(ctx, s, userID); err != nil {
		return Completion{}, err
	}
	pgUserID := pgtype.UUID{Bytes: userID, Valid: true}
	pgDailyID := pgtype.UUID{Bytes: id, Valid: true}

	completedRow, err := s.MarkDailyComplete(ctx, database.MarkDailyCompleteParams{
		ID:     pgDailyID,
		UserID: pgUserID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if inspectErr := m.inspectStatusMismatch(ctx, s, userID, id); inspectErr != nil {
				return Completion{}, inspectErr
			}
		}
		return Completion{}, fmt.Errorf("mark daily complete: %w", err)
	}

	if err := s.CreateDailyHistory(ctx, database.CreateDailyHistoryParams{
		DailyID:     completedRow.ID,
		UserID:      completedRow.UserID,
		Title:       completedRow.Title,
		Description: completedRow.Description,
		Difficulty:  completedRow.Difficulty,
		DueDate:     completedRow.DueDate,
		TimeZone:    completedRow.TimeZone,
		Status:      string(StatusCompleted),
		CompletedAt: completedRow.UpdatedAt,
		MissedAt:    pgtype.Timestamptz{Valid: false},
	}); err != nil {
		return Completion{}, fmt.Errorf("create daily history: %w", err)
	}

	reward, err := s.GetDifficultyReward(ctx, completedRow.Difficulty)
	if err != nil {
		return Completion{}, fmt.Errorf("get difficulty reward: %w", err)
	}

	payload, err := json.Marshal(events.DailyCompleted{
		Version:         1,
		UserID:          userID.String(),
		DailyID:         id.String(),
		Difficulty:      completedRow.Difficulty,
		RewardMaterials: int(reward.RewardMaterials),
	})
	if err != nil {
		return Completion{}, fmt.Errorf("marshal daily.completed event: %w", err)
	}
	requestID := sharedhttp.RequestIDFromContext(ctx)
	if err := s.InsertOutbox(ctx, database.InsertOutboxParams{
		EventID:   pgtype.UUID{Bytes: uuid.New(), Valid: true},
		EventType: dailyCompletedEventType,
		Payload:   payload,
		RequestID: pgtype.Text{String: requestID, Valid: requestID != ""},
	}); err != nil {
		return Completion{}, fmt.Errorf("insert daily.completed outbox event: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Completion{}, fmt.Errorf("commit tx: %w", err)
	}

	return Completion{
		Daily:            toDomainDaily(completedRow),
		AwardedMaterials: int(reward.RewardMaterials),
	}, nil
}

// Difficulties returns the backend-owned reward and damage metadata for every
// supported difficulty tier in canonical order.
func (m *DailyManager) Difficulties(ctx context.Context) ([]DifficultyMetadata, error) {
	rows, err := m.baseStore.ListDifficultyRewards(ctx)
	if err != nil {
		return nil, fmt.Errorf("list difficulty rewards: %w", err)
	}
	items := make([]DifficultyMetadata, len(rows))
	for i, row := range rows {
		items[i] = DifficultyMetadata{
			Difficulty:      Difficulty(row.Difficulty),
			RewardMaterials: int(row.RewardMaterials),
			DamageAmount:    int(row.DamageAmount),
		}
	}
	return items, nil
}

// ensurePlayerReady returns ErrPlayerNotReady until the user.created consumer
// has populated users_cache for the Player, so an unprovisioned Player is
// distinguishable from absence, validation, and internal failure.
func ensurePlayerReady(ctx context.Context, store Store, userID uuid.UUID) error {
	exists, err := store.UserCacheExists(ctx, pgtype.UUID{Bytes: userID, Valid: true})
	if err != nil {
		return fmt.Errorf("check player provisioning: %w", err)
	}
	if !exists {
		return ErrPlayerNotReady
	}
	return nil
}

// validateContent enforces the Daily title and description length limits. An
// empty value is within limits, so update callers can validate one field at a
// time by passing "" for the other.
func validateContent(title, description string) error {
	if utf8.RuneCountInString(title) > MaxTitleLength {
		return ErrTitleTooLong
	}
	if utf8.RuneCountInString(description) > MaxDescriptionLength {
		return ErrDescriptionTooLong
	}
	return nil
}

func (m *DailyManager) inspectStatusMismatch(ctx context.Context, s Store, userID, id uuid.UUID) error {
	existing, err := s.GetDaily(ctx, database.GetDailyParams{
		ID:     pgtype.UUID{Bytes: id, Valid: true},
		UserID: pgtype.UUID{Bytes: userID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrDailyNotFound
		}
		return fmt.Errorf("get daily: %w", err)
	}
	if existing.Status == string(StatusCompleted) {
		return ErrDailyAlreadyCompleted
	}
	if existing.Status != string(StatusPending) {
		return ErrDailyNotPending
	}
	return nil
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
		TimeZone:    row.TimeZone,
		Status:      Status(row.Status),
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
	}
}

func toDomainDailyHistory(row database.DailyHistory) DailyHistory {
	var id, dailyID, userID uuid.UUID
	if row.ID.Valid {
		id = row.ID.Bytes
	}
	if row.DailyID.Valid {
		dailyID = row.DailyID.Bytes
	}
	if row.UserID.Valid {
		userID = row.UserID.Bytes
	}
	var dueDate, archivedAt time.Time
	if row.DueDate.Valid {
		dueDate = row.DueDate.Time
	}
	if row.ArchivedAt.Valid {
		archivedAt = row.ArchivedAt.Time
	}
	var completedAt, missedAt *time.Time
	if row.CompletedAt.Valid {
		t := row.CompletedAt.Time
		completedAt = &t
	}
	if row.MissedAt.Valid {
		t := row.MissedAt.Time
		missedAt = &t
	}
	return DailyHistory{
		ID:          id,
		DailyID:     dailyID,
		UserID:      userID,
		Title:       row.Title,
		Description: row.Description,
		Difficulty:  Difficulty(row.Difficulty),
		DueDate:     dueDate,
		TimeZone:    row.TimeZone,
		Status:      Status(row.Status),
		CompletedAt: completedAt,
		MissedAt:    missedAt,
		ArchivedAt:  archivedAt,
	}
}
