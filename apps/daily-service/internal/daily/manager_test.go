package daily

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
)

type fakeTx struct {
	pgx.Tx
	committed  bool
	rolledBack bool
}

func (f *fakeTx) Commit(ctx context.Context) error {
	f.committed = true
	return nil
}

func (f *fakeTx) Rollback(ctx context.Context) error {
	f.rolledBack = true
	return nil
}

type fakeTxWithCommitError struct {
	pgx.Tx
	err        error
	rolledBack bool
}

func (f *fakeTxWithCommitError) Commit(ctx context.Context) error {
	return f.err
}

func (f *fakeTxWithCommitError) Rollback(ctx context.Context) error {
	f.rolledBack = true
	return nil
}

type fakeTxStarter struct {
	tx pgx.Tx
}

func (f *fakeTxStarter) Begin(ctx context.Context) (pgx.Tx, error) {
	if f.tx == nil {
		f.tx = &fakeTx{}
	}
	return f.tx, nil
}

type threadSafeTxStarter struct{}

func (s *threadSafeTxStarter) Begin(ctx context.Context) (pgx.Tx, error) {
	return &fakeTx{}, nil
}

type mockStore struct {
	createDaily         func(ctx context.Context, arg database.CreateDailyParams) (database.Daily, error)
	listDailies         func(ctx context.Context, arg database.ListDailiesParams) ([]database.Daily, error)
	getDaily            func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error)
	updateDaily         func(ctx context.Context, arg database.UpdateDailyParams) (database.Daily, error)
	deleteDaily         func(ctx context.Context, arg database.DeleteDailyParams) (int64, error)
	markDailyComplete   func(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error)
	getDifficultyReward func(ctx context.Context, difficulty string) (database.DifficultyReward, error)
	createDailyHistory  func(ctx context.Context, arg database.CreateDailyHistoryParams) error
	listDailyHistory    func(ctx context.Context, userID pgtype.UUID) ([]database.DailyHistory, error)
}

func (m *mockStore) CreateDaily(ctx context.Context, arg database.CreateDailyParams) (database.Daily, error) {
	if m.createDaily != nil {
		return m.createDaily(ctx, arg)
	}
	return database.Daily{}, errors.New("unexpected CreateDaily")
}

func (m *mockStore) ListDailies(ctx context.Context, arg database.ListDailiesParams) ([]database.Daily, error) {
	if m.listDailies != nil {
		return m.listDailies(ctx, arg)
	}
	return nil, errors.New("unexpected ListDailies")
}

func (m *mockStore) GetDaily(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
	if m.getDaily != nil {
		return m.getDaily(ctx, arg)
	}
	return database.Daily{}, errors.New("unexpected GetDaily")
}

func (m *mockStore) UpdateDaily(ctx context.Context, arg database.UpdateDailyParams) (database.Daily, error) {
	if m.updateDaily != nil {
		return m.updateDaily(ctx, arg)
	}
	return database.Daily{}, errors.New("unexpected UpdateDaily")
}

func (m *mockStore) DeleteDaily(ctx context.Context, arg database.DeleteDailyParams) (int64, error) {
	if m.deleteDaily != nil {
		return m.deleteDaily(ctx, arg)
	}
	return 0, errors.New("unexpected DeleteDaily")
}

func (m *mockStore) MarkDailyComplete(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error) {
	if m.markDailyComplete != nil {
		return m.markDailyComplete(ctx, arg)
	}
	return database.Daily{}, errors.New("unexpected MarkDailyComplete")
}

func (m *mockStore) GetDifficultyReward(ctx context.Context, difficulty string) (database.DifficultyReward, error) {
	if m.getDifficultyReward != nil {
		return m.getDifficultyReward(ctx, difficulty)
	}
	return database.DifficultyReward{}, errors.New("unexpected GetDifficultyReward")
}

func (m *mockStore) CreateDailyHistory(ctx context.Context, arg database.CreateDailyHistoryParams) error {
	if m.createDailyHistory != nil {
		return m.createDailyHistory(ctx, arg)
	}
	return errors.New("unexpected CreateDailyHistory")
}

func (m *mockStore) ListDailyHistory(ctx context.Context, userID pgtype.UUID) ([]database.DailyHistory, error) {
	if m.listDailyHistory != nil {
		return m.listDailyHistory(ctx, userID)
	}
	return nil, errors.New("unexpected ListDailyHistory")
}

type mockPublisher struct {
	mu        sync.Mutex
	published []events.DailyCompleted
	err       error
}

func (p *mockPublisher) Publish(ctx context.Context, eventType string, payload any, opts ...events.PublishOption) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.err != nil {
		return p.err
	}
	if event, ok := payload.(events.DailyCompleted); ok {
		p.published = append(p.published, event)
	}
	return nil
}

func TestDailyManager_Create(t *testing.T) {
	userID := uuid.New()
	dailyID := uuid.New()
	now := time.Now().UTC()

	store := &mockStore{
		createDaily: func(ctx context.Context, arg database.CreateDailyParams) (database.Daily, error) {
			return database.Daily{
				ID:          pgtype.UUID{Bytes: dailyID, Valid: true},
				UserID:      arg.UserID,
				Title:       arg.Title,
				Description: arg.Description,
				Difficulty:  arg.Difficulty,
				DueDate:     arg.DueDate,
				Status:      "PENDING",
				CreatedAt:   pgtype.Timestamptz{Time: now, Valid: true},
				UpdatedAt:   pgtype.Timestamptz{Time: now, Valid: true},
			}, nil
		},
	}

	mgr := NewDailyManager(nil, nil, store, nil)

	t.Run("happy path creates pending daily", func(t *testing.T) {
		item, err := mgr.Create(context.Background(), CreateInput{
			UserID:      userID,
			Title:       "Test task",
			Description: "Do something",
			Difficulty:  DifficultyMedium,
			DueDate:     now.Add(24 * time.Hour),
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if item.ID != dailyID {
			t.Errorf("ID = %v, want %v", item.ID, dailyID)
		}
		if item.Status != StatusPending {
			t.Errorf("Status = %v, want PENDING", item.Status)
		}
	})

	t.Run("returns ErrInvalidDifficulty when difficulty is invalid", func(t *testing.T) {
		_, err := mgr.Create(context.Background(), CreateInput{
			UserID:      userID,
			Title:       "Test task",
			Description: "Do something",
			Difficulty:  Difficulty("EXTREME"),
			DueDate:     now.Add(24 * time.Hour),
		})
		if !errors.Is(err, ErrInvalidDifficulty) {
			t.Errorf("error = %v, want ErrInvalidDifficulty", err)
		}
	})
}

func TestDailyManager_Get(t *testing.T) {
	userID := uuid.New()
	dailyID := uuid.New()

	t.Run("found", func(t *testing.T) {
		store := &mockStore{
			getDaily: func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
				return database.Daily{
					ID:     pgtype.UUID{Bytes: dailyID, Valid: true},
					UserID: pgtype.UUID{Bytes: userID, Valid: true},
					Title:  "Existing",
					Status: "PENDING",
				}, nil
			},
		}
		mgr := NewDailyManager(nil, nil, store, nil)
		item, err := mgr.Get(context.Background(), userID, dailyID)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if item.Title != "Existing" {
			t.Errorf("Title = %v, want Existing", item.Title)
		}
	})

	t.Run("not found", func(t *testing.T) {
		store := &mockStore{
			getDaily: func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
				return database.Daily{}, pgx.ErrNoRows
			},
		}
		mgr := NewDailyManager(nil, nil, store, nil)
		_, err := mgr.Get(context.Background(), userID, dailyID)
		if !errors.Is(err, ErrDailyNotFound) {
			t.Errorf("error = %v, want ErrDailyNotFound", err)
		}
	})
}

func TestDailyManager_List(t *testing.T) {
	userID := uuid.New()

	t.Run("returns all dailies without filter", func(t *testing.T) {
		store := &mockStore{
			listDailies: func(ctx context.Context, arg database.ListDailiesParams) ([]database.Daily, error) {
				if arg.UserID.Bytes != userID {
					t.Errorf("user_id = %v, want %v", arg.UserID.Bytes, userID)
				}
				if arg.Status.Valid {
					t.Errorf("status should not be valid")
				}
				if arg.DueDate.Valid {
					t.Errorf("due_date should not be valid")
				}
				return []database.Daily{
					{ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}, Title: "One"},
					{ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}, Title: "Two"},
				}, nil
			},
		}
		mgr := NewDailyManager(nil, nil, store, nil)
		items, err := mgr.List(context.Background(), userID, ListFilter{})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(items) != 2 {
			t.Errorf("len(items) = %d, want 2", len(items))
		}
	})

	t.Run("filters by status and date", func(t *testing.T) {
		statusFilter := StatusPending
		dateFilter := time.Date(2026, 9, 15, 0, 0, 0, 0, time.UTC)

		store := &mockStore{
			listDailies: func(ctx context.Context, arg database.ListDailiesParams) ([]database.Daily, error) {
				if !arg.Status.Valid || arg.Status.String != string(statusFilter) {
					t.Errorf("status = %v, want %v", arg.Status.String, statusFilter)
				}
				if !arg.DueDate.Valid || !arg.DueDate.Time.Equal(dateFilter) {
					t.Errorf("due_date = %v, want %v", arg.DueDate.Time, dateFilter)
				}
				return []database.Daily{
					{ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}, Title: "Filtered", Status: "PENDING"},
				}, nil
			},
		}
		mgr := NewDailyManager(nil, nil, store, nil)
		items, err := mgr.List(context.Background(), userID, ListFilter{
			Status: &statusFilter,
			Date:   &dateFilter,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(items) != 1 {
			t.Errorf("len(items) = %d, want 1", len(items))
		}
	})
}

func TestDailyManager_Update(t *testing.T) {
	userID := uuid.New()
	dailyID := uuid.New()
	newTitle := "Updated Title"

	t.Run("happy path updates pending daily", func(t *testing.T) {
		tx := &fakeTx{}
		txStarter := &fakeTxStarter{tx: tx}
		store := &mockStore{
			updateDaily: func(ctx context.Context, arg database.UpdateDailyParams) (database.Daily, error) {
				return database.Daily{
					ID:     arg.ID,
					UserID: arg.UserID,
					Title:  arg.Title.String,
					Status: "PENDING",
				}, nil
			},
		}
		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil, nil)
		item, err := mgr.Update(context.Background(), userID, dailyID, UpdateInput{Title: &newTitle})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if item.Title != newTitle {
			t.Errorf("Title = %v, want %v", item.Title, newTitle)
		}
		if !tx.committed {
			t.Errorf("tx was not committed")
		}
	})

	t.Run("returns ErrDailyNotFound when row does not exist", func(t *testing.T) {
		txStarter := &fakeTxStarter{}
		store := &mockStore{
			updateDaily: func(ctx context.Context, arg database.UpdateDailyParams) (database.Daily, error) {
				return database.Daily{}, pgx.ErrNoRows
			},
			getDaily: func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
				return database.Daily{}, pgx.ErrNoRows
			},
		}
		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil, nil)
		_, err := mgr.Update(context.Background(), userID, dailyID, UpdateInput{Title: &newTitle})
		if !errors.Is(err, ErrDailyNotFound) {
			t.Errorf("error = %v, want ErrDailyNotFound", err)
		}
	})

	t.Run("happy path updates completed daily", func(t *testing.T) {
		tx := &fakeTx{}
		txStarter := &fakeTxStarter{tx: tx}
		store := &mockStore{
			updateDaily: func(ctx context.Context, arg database.UpdateDailyParams) (database.Daily, error) {
				return database.Daily{
					ID:     arg.ID,
					UserID: arg.UserID,
					Title:  arg.Title.String,
					Status: "COMPLETED",
				}, nil
			},
		}
		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil, nil)
		item, err := mgr.Update(context.Background(), userID, dailyID, UpdateInput{Title: &newTitle})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if item.Title != newTitle {
			t.Errorf("Title = %v, want %v", item.Title, newTitle)
		}
		if item.Status != StatusCompleted {
			t.Errorf("Status = %v, want COMPLETED", item.Status)
		}
		if !tx.committed {
			t.Errorf("tx was not committed")
		}
	})

	t.Run("returns ErrInvalidDifficulty when difficulty is invalid", func(t *testing.T) {
		invalidDiff := Difficulty("SUPER_HARD")
		mgr := NewDailyManager(nil, nil, nil, nil)
		_, err := mgr.Update(context.Background(), userID, dailyID, UpdateInput{Difficulty: &invalidDiff})
		if !errors.Is(err, ErrInvalidDifficulty) {
			t.Errorf("error = %v, want ErrInvalidDifficulty", err)
		}
	})
}

func TestDailyManager_Delete(t *testing.T) {
	userID := uuid.New()
	dailyID := uuid.New()

	t.Run("happy path deletes pending daily", func(t *testing.T) {
		tx := &fakeTx{}
		txStarter := &fakeTxStarter{tx: tx}
		store := &mockStore{
			deleteDaily: func(ctx context.Context, arg database.DeleteDailyParams) (int64, error) {
				return 1, nil
			},
		}
		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil, nil)
		err := mgr.Delete(context.Background(), userID, dailyID)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !tx.committed {
			t.Errorf("tx was not committed")
		}
	})

	t.Run("returns ErrDailyNotFound when row does not exist", func(t *testing.T) {
		txStarter := &fakeTxStarter{}
		store := &mockStore{
			deleteDaily: func(ctx context.Context, arg database.DeleteDailyParams) (int64, error) {
				return 0, nil
			},
			getDaily: func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
				return database.Daily{}, pgx.ErrNoRows
			},
		}
		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil, nil)
		err := mgr.Delete(context.Background(), userID, dailyID)
		if !errors.Is(err, ErrDailyNotFound) {
			t.Errorf("error = %v, want ErrDailyNotFound", err)
		}
	})

	t.Run("happy path deletes completed daily", func(t *testing.T) {
		tx := &fakeTx{}
		txStarter := &fakeTxStarter{tx: tx}
		store := &mockStore{
			deleteDaily: func(ctx context.Context, arg database.DeleteDailyParams) (int64, error) {
				return 1, nil
			},
		}
		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil, nil)
		err := mgr.Delete(context.Background(), userID, dailyID)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !tx.committed {
			t.Errorf("tx was not committed")
		}
	})
}

func TestDailyManager_Complete(t *testing.T) {
	userID := uuid.New()
	dailyID := uuid.New()

	t.Run("happy path completes daily, creates history, and publishes event", func(t *testing.T) {
		tx := &fakeTx{}
		txStarter := &fakeTxStarter{tx: tx}
		pub := &mockPublisher{}
		var createdHistory *database.CreateDailyHistoryParams
		now := time.Now().UTC()
		store := &mockStore{
			markDailyComplete: func(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error) {
				return database.Daily{
					ID:          arg.ID,
					UserID:      arg.UserID,
					Title:       "Test Daily",
					Description: "Test Description",
					Difficulty:  "HARD",
					DueDate:     pgtype.Timestamptz{Time: now, Valid: true},
					Status:      "COMPLETED",
					UpdatedAt:   pgtype.Timestamptz{Time: now, Valid: true},
				}, nil
			},
			getDifficultyReward: func(ctx context.Context, difficulty string) (database.DifficultyReward, error) {
				return database.DifficultyReward{Difficulty: difficulty, RewardMaterials: 25}, nil
			},
			createDailyHistory: func(ctx context.Context, arg database.CreateDailyHistoryParams) error {
				createdHistory = &arg
				return nil
			},
		}

		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil, pub)
		item, err := mgr.Complete(context.Background(), userID, dailyID)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if item.Status != StatusCompleted {
			t.Errorf("Status = %v, want COMPLETED", item.Status)
		}
		if !tx.committed {
			t.Errorf("tx was not committed")
		}
		if createdHistory == nil {
			t.Fatalf("CreateDailyHistory was not called")
		}
		if createdHistory.DailyID.Bytes != dailyID {
			t.Errorf("createdHistory.DailyID = %v, want %v", createdHistory.DailyID.Bytes, dailyID)
		}
		if createdHistory.UserID.Bytes != userID {
			t.Errorf("createdHistory.UserID = %v, want %v", createdHistory.UserID.Bytes, userID)
		}
		if createdHistory.Status != "COMPLETED" {
			t.Errorf("createdHistory.Status = %v, want COMPLETED", createdHistory.Status)
		}
		if !createdHistory.CompletedAt.Valid {
			t.Errorf("createdHistory.CompletedAt should be valid")
		}
		if createdHistory.MissedAt.Valid {
			t.Errorf("createdHistory.MissedAt should NOT be valid")
		}
		if len(pub.published) != 1 {
			t.Fatalf("len(published) = %d, want 1", len(pub.published))
		}
		if pub.published[0].RewardMaterials != 25 {
			t.Errorf("reward = %d, want 25", pub.published[0].RewardMaterials)
		}
	})

	t.Run("returns error and rolls back if createDailyHistory fails", func(t *testing.T) {
		tx := &fakeTx{}
		txStarter := &fakeTxStarter{tx: tx}
		pub := &mockPublisher{}
		store := &mockStore{
			markDailyComplete: func(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error) {
				return database.Daily{
					ID:         arg.ID,
					UserID:     arg.UserID,
					Difficulty: "HARD",
					Status:     "COMPLETED",
				}, nil
			},
			getDifficultyReward: func(ctx context.Context, difficulty string) (database.DifficultyReward, error) {
				return database.DifficultyReward{Difficulty: difficulty, RewardMaterials: 25}, nil
			},
			createDailyHistory: func(ctx context.Context, arg database.CreateDailyHistoryParams) error {
				return errors.New("history insert error")
			},
		}

		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil, pub)
		_, err := mgr.Complete(context.Background(), userID, dailyID)
		if err == nil {
			t.Fatalf("expected error when createDailyHistory fails")
		}
		if !tx.rolledBack {
			t.Errorf("tx was not rolled back")
		}
		if len(pub.published) != 0 {
			t.Errorf("published events = %d, want 0", len(pub.published))
		}
	})

	t.Run("returns ErrDailyNotFound when daily does not exist", func(t *testing.T) {
		txStarter := &fakeTxStarter{}
		store := &mockStore{
			markDailyComplete: func(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error) {
				return database.Daily{}, pgx.ErrNoRows
			},
			getDaily: func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
				return database.Daily{}, pgx.ErrNoRows
			},
		}

		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil, nil)
		_, err := mgr.Complete(context.Background(), userID, dailyID)
		if !errors.Is(err, ErrDailyNotFound) {
			t.Errorf("error = %v, want ErrDailyNotFound", err)
		}
	})

	t.Run("returns ErrDailyAlreadyCompleted when daily is already completed", func(t *testing.T) {
		txStarter := &fakeTxStarter{}
		store := &mockStore{
			markDailyComplete: func(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error) {
				return database.Daily{}, pgx.ErrNoRows
			},
			getDaily: func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
				return database.Daily{Status: "COMPLETED"}, nil
			},
		}

		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil, nil)
		_, err := mgr.Complete(context.Background(), userID, dailyID)
		if !errors.Is(err, ErrDailyAlreadyCompleted) {
			t.Errorf("error = %v, want ErrDailyAlreadyCompleted", err)
		}
	})

	t.Run("returns ErrDailyNotPending when daily is missed", func(t *testing.T) {
		txStarter := &fakeTxStarter{}
		store := &mockStore{
			markDailyComplete: func(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error) {
				return database.Daily{}, pgx.ErrNoRows
			},
			getDaily: func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
				return database.Daily{Status: "MISSED"}, nil
			},
		}

		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil, nil)
		_, err := mgr.Complete(context.Background(), userID, dailyID)
		if !errors.Is(err, ErrDailyNotPending) {
			t.Errorf("error = %v, want ErrDailyNotPending", err)
		}
	})

	t.Run("does not publish event if commit fails", func(t *testing.T) {
		failTx := &fakeTxWithCommitError{err: errors.New("commit failed")}
		txStarter := &fakeTxStarter{tx: failTx}
		pub := &mockPublisher{}
		store := &mockStore{
			markDailyComplete: func(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error) {
				return database.Daily{
					ID:         arg.ID,
					UserID:     arg.UserID,
					Difficulty: "HARD",
					Status:     "COMPLETED",
				}, nil
			},
			getDifficultyReward: func(ctx context.Context, difficulty string) (database.DifficultyReward, error) {
				return database.DifficultyReward{Difficulty: difficulty, RewardMaterials: 25}, nil
			},
			createDailyHistory: func(ctx context.Context, arg database.CreateDailyHistoryParams) error {
				return nil
			},
		}

		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil, pub)
		_, err := mgr.Complete(context.Background(), userID, dailyID)
		if err == nil {
			t.Fatalf("expected commit error")
		}
		if len(pub.published) != 0 {
			t.Errorf("published events = %d, want 0", len(pub.published))
		}
	})

	t.Run("concurrent Complete requests allow only one winner and return ErrDailyAlreadyCompleted for losers", func(t *testing.T) {
		txStarter := &threadSafeTxStarter{}
		pub := &mockPublisher{}

		var mu sync.Mutex
		taskStatus := string(StatusPending)

		store := &mockStore{
			markDailyComplete: func(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error) {
				mu.Lock()
				defer mu.Unlock()
				if taskStatus != string(StatusPending) {
					return database.Daily{}, pgx.ErrNoRows
				}
				taskStatus = string(StatusCompleted)
				return database.Daily{
					ID:         arg.ID,
					UserID:     arg.UserID,
					Difficulty: "HARD",
					Status:     string(StatusCompleted),
				}, nil
			},
			getDaily: func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
				mu.Lock()
				defer mu.Unlock()
				return database.Daily{
					ID:     arg.ID,
					UserID: arg.UserID,
					Status: taskStatus,
				}, nil
			},
			getDifficultyReward: func(ctx context.Context, difficulty string) (database.DifficultyReward, error) {
				return database.DifficultyReward{Difficulty: difficulty, RewardMaterials: 25}, nil
			},
			createDailyHistory: func(ctx context.Context, arg database.CreateDailyHistoryParams) error {
				return nil
			},
		}

		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil, pub)

		const concurrency = 10
		var wg sync.WaitGroup
		var successCount int64
		var alreadyCompletedCount int64

		for i := 0; i < concurrency; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, err := mgr.Complete(context.Background(), userID, dailyID)
				if err == nil {
					atomic.AddInt64(&successCount, 1)
				} else if errors.Is(err, ErrDailyAlreadyCompleted) {
					atomic.AddInt64(&alreadyCompletedCount, 1)
				}
			}()
		}

		wg.Wait()

		if successCount != 1 {
			t.Errorf("successCount = %d, want 1", successCount)
		}
		if alreadyCompletedCount != concurrency-1 {
			t.Errorf("alreadyCompletedCount = %d, want %d", alreadyCompletedCount, concurrency-1)
		}
		pub.mu.Lock()
		defer pub.mu.Unlock()
		if len(pub.published) != 1 {
			t.Errorf("published events = %d, want 1", len(pub.published))
		}
	})
}

func TestDailyManager_ListHistory(t *testing.T) {
	userID := uuid.New()
	dailyID := uuid.New()
	historyID := uuid.New()
	now := time.Now().UTC()

	t.Run("returns history items for user", func(t *testing.T) {
		store := &mockStore{
			listDailyHistory: func(ctx context.Context, uID pgtype.UUID) ([]database.DailyHistory, error) {
				if uID.Bytes != userID {
					t.Errorf("user_id = %v, want %v", uID.Bytes, userID)
				}
				return []database.DailyHistory{
					{
						ID:          pgtype.UUID{Bytes: historyID, Valid: true},
						DailyID:     pgtype.UUID{Bytes: dailyID, Valid: true},
						UserID:      uID,
						Title:       "Meditate",
						Description: "15 minutes",
						Difficulty:  "MEDIUM",
						DueDate:     pgtype.Timestamptz{Time: now, Valid: true},
						Status:      "COMPLETED",
						CompletedAt: pgtype.Timestamptz{Time: now, Valid: true},
						MissedAt:    pgtype.Timestamptz{Valid: false},
						ArchivedAt:  pgtype.Timestamptz{Time: now, Valid: true},
					},
				}, nil
			},
		}

		mgr := NewDailyManager(nil, nil, store, nil)
		items, err := mgr.ListHistory(context.Background(), userID)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(items) != 1 {
			t.Fatalf("len(items) = %d, want 1", len(items))
		}
		item := items[0]
		if item.ID != historyID {
			t.Errorf("ID = %v, want %v", item.ID, historyID)
		}
		if item.DailyID != dailyID {
			t.Errorf("DailyID = %v, want %v", item.DailyID, dailyID)
		}
		if item.UserID != userID {
			t.Errorf("UserID = %v, want %v", item.UserID, userID)
		}
		if item.Title != "Meditate" {
			t.Errorf("Title = %q, want Meditate", item.Title)
		}
		if item.Difficulty != DifficultyMedium {
			t.Errorf("Difficulty = %v, want MEDIUM", item.Difficulty)
		}
		if item.Status != StatusCompleted {
			t.Errorf("Status = %v, want COMPLETED", item.Status)
		}
		if item.CompletedAt == nil || !item.CompletedAt.Equal(now) {
			t.Errorf("CompletedAt = %v, want %v", item.CompletedAt, now)
		}
		if item.MissedAt != nil {
			t.Errorf("MissedAt = %v, want nil", item.MissedAt)
		}
	})

	t.Run("returns error when store fails", func(t *testing.T) {
		store := &mockStore{
			listDailyHistory: func(ctx context.Context, uID pgtype.UUID) ([]database.DailyHistory, error) {
				return nil, errors.New("db error")
			},
		}

		mgr := NewDailyManager(nil, nil, store, nil)
		_, err := mgr.ListHistory(context.Background(), userID)
		if err == nil {
			t.Fatalf("expected error from ListHistory")
		}
	})
}
