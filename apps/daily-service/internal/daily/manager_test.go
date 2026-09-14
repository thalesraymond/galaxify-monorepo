package daily

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
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

// recordingTxStarter counts Begin calls so tests can prove that validation
// rejected a request before any transaction was opened.
type recordingTxStarter struct {
	calls int
}

func (s *recordingTxStarter) Begin(ctx context.Context) (pgx.Tx, error) {
	s.calls++
	return &fakeTx{}, nil
}

type mockStore struct {
	createDaily           func(ctx context.Context, arg database.CreateDailyParams) (database.Daily, error)
	listDailies           func(ctx context.Context, arg database.ListDailiesParams) ([]database.Daily, error)
	getDaily              func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error)
	updateDaily           func(ctx context.Context, arg database.UpdateDailyParams) (database.Daily, error)
	deleteDaily           func(ctx context.Context, arg database.DeleteDailyParams) (int64, error)
	markDailyComplete     func(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error)
	getDifficultyReward   func(ctx context.Context, difficulty string) (database.DifficultyReward, error)
	listDifficultyRewards func(ctx context.Context) ([]database.DifficultyReward, error)
	createDailyHistory    func(ctx context.Context, arg database.CreateDailyHistoryParams) error
	listDailyHistory      func(ctx context.Context, arg database.ListDailyHistoryParams) ([]database.DailyHistory, error)
	insertOutbox          func(ctx context.Context, arg database.InsertOutboxParams) error
	userCacheExists       func(ctx context.Context, id pgtype.UUID) (bool, error)
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

func (m *mockStore) ListDifficultyRewards(ctx context.Context) ([]database.DifficultyReward, error) {
	if m.listDifficultyRewards != nil {
		return m.listDifficultyRewards(ctx)
	}
	return nil, errors.New("unexpected ListDifficultyRewards")
}

func (m *mockStore) UserCacheExists(ctx context.Context, id pgtype.UUID) (bool, error) {
	if m.userCacheExists != nil {
		return m.userCacheExists(ctx, id)
	}
	return false, errors.New("unexpected UserCacheExists")
}

func (m *mockStore) CreateDailyHistory(ctx context.Context, arg database.CreateDailyHistoryParams) error {
	if m.createDailyHistory != nil {
		return m.createDailyHistory(ctx, arg)
	}
	return errors.New("unexpected CreateDailyHistory")
}

func (m *mockStore) ListDailyHistory(ctx context.Context, arg database.ListDailyHistoryParams) ([]database.DailyHistory, error) {
	if m.listDailyHistory != nil {
		return m.listDailyHistory(ctx, arg)
	}
	return nil, errors.New("unexpected ListDailyHistory")
}

func (m *mockStore) InsertOutbox(ctx context.Context, arg database.InsertOutboxParams) error {
	if m.insertOutbox != nil {
		return m.insertOutbox(ctx, arg)
	}
	return errors.New("unexpected InsertOutbox")
}

func TestDailyManager_Create(t *testing.T) {
	userID := uuid.New()
	dailyID := uuid.New()
	now := time.Now().UTC()

	store := &mockStore{
		userCacheExists: func(ctx context.Context, id pgtype.UUID) (bool, error) {
			return true, nil
		},
		createDaily: func(ctx context.Context, arg database.CreateDailyParams) (database.Daily, error) {
			if arg.TimeZone != "America/New_York" {
				t.Errorf("time_zone = %q, want America/New_York", arg.TimeZone)
			}
			return database.Daily{
				ID:          pgtype.UUID{Bytes: dailyID, Valid: true},
				UserID:      arg.UserID,
				Title:       arg.Title,
				Description: arg.Description,
				Difficulty:  arg.Difficulty,
				DueDate:     arg.DueDate,
				TimeZone:    arg.TimeZone,
				Status:      "PENDING",
				CreatedAt:   pgtype.Timestamptz{Time: now, Valid: true},
				UpdatedAt:   pgtype.Timestamptz{Time: now, Valid: true},
			}, nil
		},
	}

	mgr := NewDailyManager(nil, nil, store)

	t.Run("happy path creates pending daily", func(t *testing.T) {
		item, err := mgr.Create(context.Background(), CreateInput{
			UserID:      userID,
			Title:       "Test task",
			Description: "Do something",
			Difficulty:  DifficultyMedium,
			DueDate:     now.Add(24 * time.Hour),
			TimeZone:    "America/New_York",
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

	t.Run("returns ErrInvalidTimeZone and does not touch the store", func(t *testing.T) {
		for _, zone := range []string{"Mars/Olympus", "Local", "", "EST"} {
			t.Run(zone, func(t *testing.T) {
				store := &mockStore{
					createDaily: func(ctx context.Context, arg database.CreateDailyParams) (database.Daily, error) {
						t.Fatalf("CreateDaily must not be called for invalid zone %q", zone)
						return database.Daily{}, nil
					},
				}
				mgr := NewDailyManager(nil, nil, store)
				_, err := mgr.Create(context.Background(), CreateInput{
					UserID:     userID,
					Title:      "Test task",
					Difficulty: DifficultyEasy,
					DueDate:    now.Add(24 * time.Hour),
					TimeZone:   zone,
				})
				if !errors.Is(err, ErrInvalidTimeZone) {
					t.Fatalf("error = %v, want ErrInvalidTimeZone", err)
				}
			})
		}
	})
}

func TestDailyManager_CreateContentLimits(t *testing.T) {
	userID := uuid.New()
	now := time.Now().UTC()
	newStore := func() *mockStore {
		return &mockStore{
			userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
			createDaily: func(_ context.Context, arg database.CreateDailyParams) (database.Daily, error) {
				return database.Daily{ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}, Title: arg.Title, Description: arg.Description, Status: "PENDING"}, nil
			},
		}
	}

	tests := []struct {
		name    string
		title   string
		desc    string
		wantErr error
	}{
		{name: "title at the limit", title: strings.Repeat("a", MaxTitleLength)},
		{name: "description at the limit", title: "Task", desc: strings.Repeat("d", MaxDescriptionLength)},
		{name: "title counted in runes not bytes", title: strings.Repeat("é", MaxTitleLength)},
		{name: "title one past the limit", title: strings.Repeat("a", MaxTitleLength+1), wantErr: ErrTitleTooLong},
		{name: "description one past the limit", title: "Task", desc: strings.Repeat("d", MaxDescriptionLength+1), wantErr: ErrDescriptionTooLong},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mgr := NewDailyManager(nil, nil, newStore())
			_, err := mgr.Create(context.Background(), CreateInput{
				UserID: userID, Title: tt.title, Description: tt.desc, Difficulty: DifficultyEasy,
				DueDate: now.Add(24 * time.Hour), TimeZone: "UTC",
			})
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestDailyManager_CreateRequiresProvisioning(t *testing.T) {
	store := &mockStore{
		userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return false, nil },
		createDaily: func(context.Context, database.CreateDailyParams) (database.Daily, error) {
			t.Fatal("CreateDaily must not be called before the Player is provisioned")
			return database.Daily{}, nil
		},
	}
	mgr := NewDailyManager(nil, nil, store)
	_, err := mgr.Create(context.Background(), CreateInput{
		UserID: uuid.New(), Title: "Task", Difficulty: DifficultyEasy,
		DueDate: time.Now().UTC().Add(time.Hour), TimeZone: "UTC",
	})
	if !errors.Is(err, ErrPlayerNotReady) {
		t.Fatalf("error = %v, want ErrPlayerNotReady", err)
	}
}

func TestDailyManager_Get(t *testing.T) {
	userID := uuid.New()
	dailyID := uuid.New()

	t.Run("found", func(t *testing.T) {
		store := &mockStore{
			userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
			getDaily: func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
				return database.Daily{
					ID:     pgtype.UUID{Bytes: dailyID, Valid: true},
					UserID: pgtype.UUID{Bytes: userID, Valid: true},
					Title:  "Existing",
					Status: "PENDING",
				}, nil
			},
		}
		mgr := NewDailyManager(nil, nil, store)
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
			userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
			getDaily: func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
				return database.Daily{}, pgx.ErrNoRows
			},
		}
		mgr := NewDailyManager(nil, nil, store)
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
			userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
			listDailies: func(ctx context.Context, arg database.ListDailiesParams) ([]database.Daily, error) {
				if arg.UserID.Bytes != userID {
					t.Errorf("user_id = %v, want %v", arg.UserID.Bytes, userID)
				}
				if arg.Status.Valid {
					t.Errorf("status should not be valid")
				}
				if arg.From.Valid || arg.To.Valid {
					t.Errorf("range should not be valid")
				}
				return []database.Daily{
					{ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}, Title: "One"},
					{ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}, Title: "Two"},
				}, nil
			},
		}
		mgr := NewDailyManager(nil, nil, store)
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
			userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
			listDailies: func(ctx context.Context, arg database.ListDailiesParams) ([]database.Daily, error) {
				if !arg.Status.Valid || arg.Status.String != string(statusFilter) {
					t.Errorf("status = %v, want %v", arg.Status.String, statusFilter)
				}
				if !arg.From.Valid || !arg.From.Time.Equal(dateFilter) {
					t.Errorf("from = %v, want %v", arg.From.Time, dateFilter)
				}
				return []database.Daily{
					{ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}, Title: "Filtered", Status: "PENDING"},
				}, nil
			},
		}
		mgr := NewDailyManager(nil, nil, store)
		items, err := mgr.List(context.Background(), userID, ListFilter{
			Status: &statusFilter,
			From:   &dateFilter,
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
		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil)
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
		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil)
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
		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil)
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
		mgr := NewDailyManager(nil, nil, nil)
		_, err := mgr.Update(context.Background(), userID, dailyID, UpdateInput{Difficulty: &invalidDiff})
		if !errors.Is(err, ErrInvalidDifficulty) {
			t.Errorf("error = %v, want ErrInvalidDifficulty", err)
		}
	})

	t.Run("returns ErrInvalidTimeZone before opening a transaction", func(t *testing.T) {
		for _, zone := range []string{"Mars/Olympus", "Local", "", "EST"} {
			t.Run(zone, func(t *testing.T) {
				txStarter := &recordingTxStarter{}
				store := &mockStore{
					updateDaily: func(ctx context.Context, arg database.UpdateDailyParams) (database.Daily, error) {
						t.Fatalf("UpdateDaily must not be called for invalid zone %q", zone)
						return database.Daily{}, nil
					},
				}
				mgr := NewDailyManager(txStarter, func(pgx.Tx) Store { return store }, store)
				_, err := mgr.Update(context.Background(), userID, dailyID, UpdateInput{TimeZone: &zone})
				if !errors.Is(err, ErrInvalidTimeZone) {
					t.Fatalf("error = %v, want ErrInvalidTimeZone", err)
				}
				if txStarter.calls != 0 {
					t.Errorf("Begin calls = %d, want 0", txStarter.calls)
				}
			})
		}
	})

	t.Run("updates the configured time zone only when supplied", func(t *testing.T) {
		tx := &fakeTx{}
		zone := "Europe/Paris"
		store := &mockStore{
			updateDaily: func(ctx context.Context, arg database.UpdateDailyParams) (database.Daily, error) {
				if !arg.TimeZone.Valid || arg.TimeZone.String != zone {
					t.Errorf("time_zone = %+v, want %q", arg.TimeZone, zone)
				}
				return database.Daily{ID: arg.ID, UserID: arg.UserID, TimeZone: arg.TimeZone.String}, nil
			},
		}
		mgr := NewDailyManager(&fakeTxStarter{tx: tx}, func(pgx.Tx) Store { return store }, nil)
		item, err := mgr.Update(context.Background(), userID, dailyID, UpdateInput{TimeZone: &zone})
		if err != nil {
			t.Fatal(err)
		}
		if item.TimeZone != zone {
			t.Errorf("time_zone = %q, want %q", item.TimeZone, zone)
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
		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil)
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
		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil)
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
		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil)
		err := mgr.Delete(context.Background(), userID, dailyID)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !tx.committed {
			t.Errorf("tx was not committed")
		}
	})
}

// completedDailyTable is an in-memory model of the `dailies` and
// `daily_history` tables. UpdateDaily and DeleteDaily mutate `dailies` only;
// `daily_history` stays append-only, mirroring the real schema, so the manager
// seam can prove that editing/deleting a COMPLETED daily never rewrites the
// archived occurrence snapshots.
type completedDailyTable struct {
	dailies       map[uuid.UUID]database.Daily
	history       []database.DailyHistory
	historyWrites int
}

func (tbl *completedDailyTable) store() *mockStore {
	return &mockStore{
		userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
		updateDaily: func(_ context.Context, arg database.UpdateDailyParams) (database.Daily, error) {
			row, ok := tbl.dailies[arg.ID.Bytes]
			if !ok {
				return database.Daily{}, pgx.ErrNoRows
			}
			if row.UserID != arg.UserID {
				return database.Daily{}, pgx.ErrNoRows
			}
			if arg.Title.Valid {
				row.Title = arg.Title.String
			}
			if arg.Description.Valid {
				row.Description = arg.Description.String
			}
			if arg.Difficulty.Valid {
				row.Difficulty = arg.Difficulty.String
			}
			if arg.DueDate.Valid {
				row.DueDate = arg.DueDate
			}
			tbl.dailies[arg.ID.Bytes] = row
			return row, nil
		},
		deleteDaily: func(_ context.Context, arg database.DeleteDailyParams) (int64, error) {
			row, ok := tbl.dailies[arg.ID.Bytes]
			if !ok || row.UserID != arg.UserID {
				return 0, nil
			}
			delete(tbl.dailies, arg.ID.Bytes)
			return 1, nil
		},
		listDailyHistory: func(context.Context, database.ListDailyHistoryParams) ([]database.DailyHistory, error) {
			return append([]database.DailyHistory(nil), tbl.history...), nil
		},
		createDailyHistory: func(context.Context, database.CreateDailyHistoryParams) error {
			tbl.historyWrites++
			return errors.New("editing or deleting a completed daily must not write daily_history")
		},
	}
}

// TestCompletedDailyMutationsPreserveHistoryContract drives the real
// DailyManager (ADR-0011's domain seam) against a stateful store. It proves
// that a COMPLETED recurring Daily can be edited and deleted — the behavior
// the former `AND status = 'PENDING'` predicates rejected — while the archived
// occurrence snapshots remain byte-for-byte unchanged for both operations.
func TestCompletedDailyMutationsPreserveHistoryContract(t *testing.T) {
	userID := uuid.New()
	dailyID := uuid.New()
	now := time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)
	completedDaily := database.Daily{
		ID:          pgtype.UUID{Bytes: dailyID, Valid: true},
		UserID:      pgtype.UUID{Bytes: userID, Valid: true},
		Title:       "Calibrate sensors",
		Description: "before launch",
		Difficulty:  "MEDIUM",
		DueDate:     pgtype.Timestamptz{Time: now, Valid: true},
		Status:      string(StatusCompleted),
		CreatedAt:   pgtype.Timestamptz{Time: now, Valid: true},
		UpdatedAt:   pgtype.Timestamptz{Time: now, Valid: true},
	}
	occurrence := database.DailyHistory{
		ID:          pgtype.UUID{Bytes: uuid.New(), Valid: true},
		DailyID:     pgtype.UUID{Bytes: dailyID, Valid: true},
		UserID:      pgtype.UUID{Bytes: userID, Valid: true},
		Title:       "Calibrate sensors",
		Description: "before launch",
		Difficulty:  "MEDIUM",
		DueDate:     pgtype.Timestamptz{Time: now, Valid: true},
		Status:      string(StatusCompleted),
		CompletedAt: pgtype.Timestamptz{Time: now, Valid: true},
		ArchivedAt:  pgtype.Timestamptz{Time: now.Add(time.Minute), Valid: true},
	}

	tests := []struct {
		name   string
		mutate func(t *testing.T, manager *DailyManager, table *completedDailyTable)
	}{
		{
			name: "update completed daily",
			mutate: func(t *testing.T, manager *DailyManager, table *completedDailyTable) {
				t.Helper()
				title := "Recalibrate sensors"
				updated, err := manager.Update(context.Background(), userID, dailyID, UpdateInput{Title: &title})
				if err != nil {
					t.Fatalf("Update() error = %v; completed dailies must stay editable", err)
				}
				if updated.Status != StatusCompleted {
					t.Errorf("Update() status = %q, want COMPLETED", updated.Status)
				}
				if got := table.dailies[dailyID].Title; got != title {
					t.Errorf("persisted title = %q, want %q", got, title)
				}
			},
		},
		{
			name: "delete completed daily",
			mutate: func(t *testing.T, manager *DailyManager, table *completedDailyTable) {
				t.Helper()
				if err := manager.Delete(context.Background(), userID, dailyID); err != nil {
					t.Fatalf("Delete() error = %v; completed dailies must stay deletable", err)
				}
				if _, ok := table.dailies[dailyID]; ok {
					t.Error("daily still present after Delete()")
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			table := &completedDailyTable{
				dailies: map[uuid.UUID]database.Daily{dailyID: completedDaily},
				history: []database.DailyHistory{occurrence},
			}
			store := table.store()
			tx := &fakeTx{}
			manager := NewDailyManager(&fakeTxStarter{tx: tx}, func(pgx.Tx) Store { return store }, store)

			before := encodedHistoryContract(t, manager, userID)
			tt.mutate(t, manager, table)
			after := encodedHistoryContract(t, manager, userID)

			if string(after) != string(before) {
				t.Errorf("daily history changed after %s:\n got %s\nwant %s", tt.name, after, before)
			}
			if table.historyWrites != 0 {
				t.Errorf("history writes = %d, want 0", table.historyWrites)
			}
			if !tx.committed {
				t.Error("mutation transaction was not committed")
			}
		})
	}
}

// encodedHistoryContract renders the user's daily history as bytes so tests can
// assert the occurrence snapshots are unchanged for the wire contract.
func encodedHistoryContract(t *testing.T, manager *DailyManager, userID uuid.UUID) []byte {
	t.Helper()
	page, err := manager.ListHistory(context.Background(), userID, HistoryQuery{Limit: MaxHistoryPageSize})
	if err != nil {
		t.Fatalf("ListHistory() error = %v", err)
	}
	encoded, err := json.Marshal(page.Items)
	if err != nil {
		t.Fatalf("marshal daily history = %v", err)
	}
	return encoded
}

func TestDailyManager_Complete(t *testing.T) {
	userID := uuid.New()
	dailyID := uuid.New()

	t.Run("happy path completes daily, creates history, and stages outbox event", func(t *testing.T) {
		tx := &fakeTx{}
		txStarter := &fakeTxStarter{tx: tx}
		var outbox *database.InsertOutboxParams
		var createdHistory *database.CreateDailyHistoryParams
		now := time.Now().UTC()
		store := &mockStore{
			userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
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
			insertOutbox: func(ctx context.Context, arg database.InsertOutboxParams) error {
				outbox = &arg
				return nil
			},
		}

		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil)
		item, err := mgr.Complete(context.Background(), userID, dailyID)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if item.Status != StatusCompleted {
			t.Errorf("Status = %v, want COMPLETED", item.Status)
		}
		if item.AwardedMaterials != 25 {
			t.Errorf("AwardedMaterials = %d, want 25", item.AwardedMaterials)
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
		if outbox == nil {
			t.Fatalf("InsertOutbox was not called")
		}
		if outbox.EventType != "daily.completed" {
			t.Errorf("outbox event_type = %q, want daily.completed", outbox.EventType)
		}
		if !outbox.EventID.Valid {
			t.Errorf("outbox event_id should be valid")
		}
		var published events.DailyCompleted
		if err := json.Unmarshal(outbox.Payload, &published); err != nil {
			t.Fatalf("decode outbox payload: %v", err)
		}
		if published.RewardMaterials != 25 {
			t.Errorf("reward = %d, want 25", published.RewardMaterials)
		}
	})

	t.Run("returns error and rolls back if createDailyHistory fails", func(t *testing.T) {
		tx := &fakeTx{}
		txStarter := &fakeTxStarter{tx: tx}
		store := &mockStore{
			userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
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

		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil)
		_, err := mgr.Complete(context.Background(), userID, dailyID)
		if err == nil {
			t.Fatalf("expected error when createDailyHistory fails")
		}
		if !tx.rolledBack {
			t.Errorf("tx was not rolled back")
		}
	})

	t.Run("returns ErrDailyNotFound when daily does not exist", func(t *testing.T) {
		txStarter := &fakeTxStarter{}
		store := &mockStore{
			userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
			markDailyComplete: func(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error) {
				return database.Daily{}, pgx.ErrNoRows
			},
			getDaily: func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
				return database.Daily{}, pgx.ErrNoRows
			},
		}

		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil)
		_, err := mgr.Complete(context.Background(), userID, dailyID)
		if !errors.Is(err, ErrDailyNotFound) {
			t.Errorf("error = %v, want ErrDailyNotFound", err)
		}
	})

	t.Run("returns ErrDailyAlreadyCompleted when daily is already completed", func(t *testing.T) {
		txStarter := &fakeTxStarter{}
		store := &mockStore{
			userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
			markDailyComplete: func(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error) {
				return database.Daily{}, pgx.ErrNoRows
			},
			getDaily: func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
				return database.Daily{Status: "COMPLETED"}, nil
			},
		}

		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil)
		_, err := mgr.Complete(context.Background(), userID, dailyID)
		if !errors.Is(err, ErrDailyAlreadyCompleted) {
			t.Errorf("error = %v, want ErrDailyAlreadyCompleted", err)
		}
	})

	t.Run("returns ErrDailyNotPending when daily is missed", func(t *testing.T) {
		txStarter := &fakeTxStarter{}
		store := &mockStore{
			userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
			markDailyComplete: func(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error) {
				return database.Daily{}, pgx.ErrNoRows
			},
			getDaily: func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
				return database.Daily{Status: "MISSED"}, nil
			},
		}

		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil)
		_, err := mgr.Complete(context.Background(), userID, dailyID)
		if !errors.Is(err, ErrDailyNotPending) {
			t.Errorf("error = %v, want ErrDailyNotPending", err)
		}
	})

	t.Run("returns commit error and rolls back the staged outbox event", func(t *testing.T) {
		commitErr := errors.New("commit failed")
		failTx := &fakeTxWithCommitError{err: commitErr}
		txStarter := &fakeTxStarter{tx: failTx}
		var outboxStaged bool
		store := &mockStore{
			userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
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
			insertOutbox: func(ctx context.Context, arg database.InsertOutboxParams) error {
				outboxStaged = true
				return nil
			},
		}

		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil)
		_, err := mgr.Complete(context.Background(), userID, dailyID)
		if !errors.Is(err, commitErr) {
			t.Fatalf("error = %v, want commit error", err)
		}
		if !outboxStaged {
			t.Errorf("outbox event was not staged before commit")
		}
		if !failTx.rolledBack {
			t.Errorf("tx was not rolled back")
		}
	})

	t.Run("concurrent Complete requests allow only one winner and return ErrDailyAlreadyCompleted for losers", func(t *testing.T) {
		txStarter := &threadSafeTxStarter{}
		var outboxCount int64

		var mu sync.Mutex
		taskStatus := string(StatusPending)

		store := &mockStore{
			userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
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
			insertOutbox: func(ctx context.Context, arg database.InsertOutboxParams) error {
				atomic.AddInt64(&outboxCount, 1)
				return nil
			},
		}

		mgr := NewDailyManager(txStarter, func(t pgx.Tx) Store { return store }, nil)

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
		if got := atomic.LoadInt64(&outboxCount); got != 1 {
			t.Errorf("staged outbox events = %d, want 1", got)
		}
	})
}

func TestDailyManager_ListHistory(t *testing.T) {
	userID := uuid.New()
	dailyID := uuid.New()
	historyID := uuid.New()
	now := time.Now().UTC()

	t.Run("returns a page for user with the default bounded size", func(t *testing.T) {
		store := &mockStore{
			userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
			listDailyHistory: func(ctx context.Context, arg database.ListDailyHistoryParams) ([]database.DailyHistory, error) {
				if arg.UserID.Bytes != userID {
					t.Errorf("user_id = %v, want %v", arg.UserID.Bytes, userID)
				}
				if arg.CursorDueDate.Valid || arg.CursorArchivedAt.Valid || arg.CursorID.Valid {
					t.Errorf("cursor = (%v, %v, %v), want unset for the first page", arg.CursorDueDate, arg.CursorArchivedAt, arg.CursorID)
				}
				if arg.PageSize != int32(DefaultHistoryPageSize)+1 {
					t.Errorf("page_size = %d, want %d (one extra to detect a following page)", arg.PageSize, DefaultHistoryPageSize+1)
				}
				return []database.DailyHistory{
					{
						ID:          pgtype.UUID{Bytes: historyID, Valid: true},
						DailyID:     pgtype.UUID{Bytes: dailyID, Valid: true},
						UserID:      arg.UserID,
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

		mgr := NewDailyManager(nil, nil, store)
		page, err := mgr.ListHistory(context.Background(), userID, HistoryQuery{})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(page.Items) != 1 {
			t.Fatalf("len(items) = %d, want 1", len(page.Items))
		}
		if page.NextCursor != "" {
			t.Errorf("NextCursor = %q, want empty when no further page exists", page.NextCursor)
		}
		item := page.Items[0]
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

	t.Run("clamps the requested page size to the maximum", func(t *testing.T) {
		var got int32
		store := &mockStore{
			userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
			listDailyHistory: func(_ context.Context, arg database.ListDailyHistoryParams) ([]database.DailyHistory, error) {
				got = arg.PageSize
				return nil, nil
			},
		}
		mgr := NewDailyManager(nil, nil, store)

		if _, err := mgr.ListHistory(context.Background(), userID, HistoryQuery{Limit: MaxHistoryPageSize * 10}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != int32(MaxHistoryPageSize)+1 {
			t.Errorf("page_size = %d, want %d", got, MaxHistoryPageSize+1)
		}
	})

	t.Run("rejects a tampered cursor before touching the store", func(t *testing.T) {
		store := &mockStore{
			userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
			listDailyHistory: func(context.Context, database.ListDailyHistoryParams) ([]database.DailyHistory, error) {
				t.Fatal("ListDailyHistory must not be called for an invalid cursor")
				return nil, nil
			},
		}
		mgr := NewDailyManager(nil, nil, store)
		if _, err := mgr.ListHistory(context.Background(), userID, HistoryQuery{Cursor: "not-a-cursor"}); !errors.Is(err, ErrInvalidHistoryCursor) {
			t.Fatalf("error = %v, want ErrInvalidHistoryCursor", err)
		}
	})

	t.Run("returns error when store fails", func(t *testing.T) {
		store := &mockStore{
			userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
			listDailyHistory: func(context.Context, database.ListDailyHistoryParams) ([]database.DailyHistory, error) {
				return nil, errors.New("db error")
			},
		}

		mgr := NewDailyManager(nil, nil, store)
		if _, err := mgr.ListHistory(context.Background(), userID, HistoryQuery{}); err == nil {
			t.Fatalf("expected error from ListHistory")
		}
	})
}

// historyKeysetTable is an in-memory model of the ListDailyHistory keyset
// query. It enforces the same ownership, (due_date, archived_at, id) tuple and
// ordering rules as the generated SQL so the manager seam can prove traversal
// behaviour — no duplicates, no omissions, stable under concurrent inserts —
// without a live database.
type historyKeysetTable struct {
	rows []database.DailyHistory
}

func (tbl *historyKeysetTable) store() *mockStore {
	return &mockStore{
		userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return true, nil },
		listDailyHistory: func(_ context.Context, arg database.ListDailyHistoryParams) ([]database.DailyHistory, error) {
			var matched []database.DailyHistory
			for _, row := range tbl.rows {
				if row.UserID != arg.UserID || !historyRowAfterCursor(row, arg) {
					continue
				}
				matched = append(matched, row)
			}
			sort.SliceStable(matched, func(i, j int) bool {
				return historyRowSortsFirst(matched[i], matched[j])
			})
			if int(arg.PageSize) < len(matched) {
				matched = matched[:arg.PageSize]
			}
			return matched, nil
		},
	}
}

func historyRowSortsFirst(a, b database.DailyHistory) bool {
	if c := a.DueDate.Time.Compare(b.DueDate.Time); c != 0 {
		return c > 0
	}
	if c := a.ArchivedAt.Time.Compare(b.ArchivedAt.Time); c != 0 {
		return c > 0
	}
	return bytes.Compare(a.ID.Bytes[:], b.ID.Bytes[:]) > 0
}

func historyRowAfterCursor(row database.DailyHistory, arg database.ListDailyHistoryParams) bool {
	if !arg.CursorDueDate.Valid {
		return true
	}
	if c := row.DueDate.Time.Compare(arg.CursorDueDate.Time); c != 0 {
		return c < 0
	}
	if c := row.ArchivedAt.Time.Compare(arg.CursorArchivedAt.Time); c != 0 {
		return c < 0
	}
	return bytes.Compare(row.ID.Bytes[:], arg.CursorID.Bytes[:]) < 0
}

func TestDailyManager_ListHistoryTraversal(t *testing.T) {
	userID := uuid.New()
	otherUserID := uuid.New()
	base := time.Date(2026, 9, 12, 8, 0, 0, 0, time.UTC)

	// id(n) yields a fixed UUID whose last byte orders it deterministically, so
	// the id tie-breaker is visible in expectations.
	id := func(n byte) uuid.UUID {
		var u uuid.UUID
		u[15] = n
		return u
	}
	rowFor := func(owner uuid.UUID, rowID uuid.UUID, due, archived time.Time) database.DailyHistory {
		return database.DailyHistory{
			ID:          pgtype.UUID{Bytes: rowID, Valid: true},
			DailyID:     pgtype.UUID{Bytes: uuid.New(), Valid: true},
			UserID:      pgtype.UUID{Bytes: owner, Valid: true},
			Title:       "Outcome",
			Description: "snapshot",
			Difficulty:  "MEDIUM",
			DueDate:     pgtype.Timestamptz{Time: due, Valid: true},
			Status:      "COMPLETED",
			ArchivedAt:  pgtype.Timestamptz{Time: archived, Valid: true},
		}
	}

	// r2 and r3 share due_date and archived_at, so only the id tie-breaker can
	// order them. rB belongs to another user and must never leak in.
	r1 := rowFor(userID, id(1), base.Add(24*time.Hour), base.Add(24*time.Hour))
	r2 := rowFor(userID, id(2), base, base)
	r3 := rowFor(userID, id(3), base, base)
	r4 := rowFor(userID, id(4), base, base.Add(-time.Hour))
	r5 := rowFor(userID, id(5), base.Add(-24*time.Hour), base.Add(-24*time.Hour))
	rB := rowFor(otherUserID, id(0xB1), base.Add(10*24*time.Hour), base.Add(10*24*time.Hour))

	wantOrder := []uuid.UUID{r1.ID.Bytes, r3.ID.Bytes, r2.ID.Bytes, r4.ID.Bytes, r5.ID.Bytes}

	t.Run("stable dataset has no duplicates or omissions", func(t *testing.T) {
		table := &historyKeysetTable{rows: []database.DailyHistory{r1, r2, r3, r4, r5, rB}}
		mgr := NewDailyManager(nil, nil, table.store())

		got := traverseHistory(t, mgr, userID, 2)
		assertHistoryOrder(t, got, wantOrder)
	})

	t.Run("a newer insert between pages does not corrupt continuation", func(t *testing.T) {
		table := &historyKeysetTable{rows: []database.DailyHistory{r1, r2, r3, r4, r5, rB}}
		mgr := NewDailyManager(nil, nil, table.store())

		first := fetchHistoryPage(t, mgr, userID, 2, "")
		// A concurrent insert newer than the cursor sorts before it; it must not
		// appear on later pages nor shift the already-observed sequence.
		table.rows = append(table.rows, rowFor(userID, id(9), base.Add(48*time.Hour), base.Add(48*time.Hour)))

		got := append(historyPageIDs(first), continueHistory(t, mgr, userID, 2, first.NextCursor)...)
		assertHistoryOrder(t, got, wantOrder)
	})

	t.Run("an older insert between pages is picked up exactly once", func(t *testing.T) {
		table := &historyKeysetTable{rows: []database.DailyHistory{r1, r2, r3, r4, r5, rB}}
		mgr := NewDailyManager(nil, nil, table.store())

		first := fetchHistoryPage(t, mgr, userID, 2, "")
		r6 := rowFor(userID, id(6), base.Add(-48*time.Hour), base.Add(-48*time.Hour))
		table.rows = append(table.rows, r6)

		got := append(historyPageIDs(first), continueHistory(t, mgr, userID, 2, first.NextCursor)...)
		want := append(append([]uuid.UUID{}, wantOrder...), r6.ID.Bytes)
		assertHistoryOrder(t, got, want)
	})

	t.Run("empty history returns an empty final page", func(t *testing.T) {
		mgr := NewDailyManager(nil, nil, (&historyKeysetTable{}).store())
		got := traverseHistory(t, mgr, userID, 5)
		if len(got) != 0 {
			t.Fatalf("ids = %v, want empty", got)
		}
	})

	t.Run("final page reports no next cursor", func(t *testing.T) {
		table := &historyKeysetTable{rows: []database.DailyHistory{r1, r2}}
		mgr := NewDailyManager(nil, nil, table.store())
		page := fetchHistoryPage(t, mgr, userID, 5, "")
		if len(page.Items) != 2 {
			t.Fatalf("len(items) = %d, want 2", len(page.Items))
		}
		if page.NextCursor != "" {
			t.Errorf("NextCursor = %q, want empty on the final page", page.NextCursor)
		}
	})
}

func TestDailyManager_UpdateContentLimits(t *testing.T) {
	userID := uuid.New()
	dailyID := uuid.New()

	tests := []struct {
		name    string
		input   UpdateInput
		wantErr error
	}{
		{name: "title at the limit", input: UpdateInput{Title: ptr(strings.Repeat("a", MaxTitleLength))}},
		{name: "description at the limit", input: UpdateInput{Description: ptr(strings.Repeat("d", MaxDescriptionLength))}},
		{name: "title one past the limit", input: UpdateInput{Title: ptr(strings.Repeat("a", MaxTitleLength+1))}, wantErr: ErrTitleTooLong},
		{name: "description one past the limit", input: UpdateInput{Description: ptr(strings.Repeat("d", MaxDescriptionLength+1))}, wantErr: ErrDescriptionTooLong},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			txStarter := &recordingTxStarter{}
			store := &mockStore{
				updateDaily: func(ctx context.Context, arg database.UpdateDailyParams) (database.Daily, error) {
					return database.Daily{ID: arg.ID, UserID: arg.UserID, Status: "PENDING"}, nil
				},
			}
			mgr := NewDailyManager(txStarter, func(pgx.Tx) Store { return store }, store)
			_, err := mgr.Update(context.Background(), userID, dailyID, tt.input)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("error = %v, want %v", err, tt.wantErr)
			}
			if tt.wantErr != nil && txStarter.calls != 0 {
				t.Errorf("Begin calls = %d, want 0 (validation must reject before opening a transaction)", txStarter.calls)
			}
		})
	}
}

func TestDailyManager_Difficulties(t *testing.T) {
	t.Run("returns typed metadata in canonical order", func(t *testing.T) {
		store := &mockStore{
			listDifficultyRewards: func(context.Context) ([]database.DifficultyReward, error) {
				return []database.DifficultyReward{
					{Difficulty: "EASY", RewardMaterials: 10, DamageAmount: 5},
					{Difficulty: "MEDIUM", RewardMaterials: 20, DamageAmount: 10},
					{Difficulty: "HARD", RewardMaterials: 30, DamageAmount: 20},
				}, nil
			},
		}
		mgr := NewDailyManager(nil, nil, store)
		items, err := mgr.Difficulties(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		want := []DifficultyMetadata{
			{Difficulty: DifficultyEasy, RewardMaterials: 10, DamageAmount: 5},
			{Difficulty: DifficultyMedium, RewardMaterials: 20, DamageAmount: 10},
			{Difficulty: DifficultyHard, RewardMaterials: 30, DamageAmount: 20},
		}
		if len(items) != len(want) {
			t.Fatalf("len(items) = %d, want %d", len(items), len(want))
		}
		for i := range want {
			if items[i] != want[i] {
				t.Errorf("items[%d] = %+v, want %+v", i, items[i], want[i])
			}
		}
	})

	t.Run("returns error when store fails", func(t *testing.T) {
		store := &mockStore{
			listDifficultyRewards: func(context.Context) ([]database.DifficultyReward, error) {
				return nil, errors.New("db error")
			},
		}
		mgr := NewDailyManager(nil, nil, store)
		if _, err := mgr.Difficulties(context.Background()); err == nil {
			t.Fatal("expected error from Difficulties")
		}
	})
}

func traverseHistory(t *testing.T, mgr *DailyManager, userID uuid.UUID, pageSize int) []uuid.UUID {
	t.Helper()
	var collected []uuid.UUID
	cursor := ""
	for i := 0; i < 100; i++ {
		page := fetchHistoryPage(t, mgr, userID, pageSize, cursor)
		collected = append(collected, historyPageIDs(page)...)
		if page.NextCursor == "" {
			return collected
		}
		cursor = page.NextCursor
	}
	t.Fatal("history traversal did not terminate")
	return nil
}

func continueHistory(t *testing.T, mgr *DailyManager, userID uuid.UUID, pageSize int, cursor string) []uuid.UUID {
	t.Helper()
	var collected []uuid.UUID
	for i := 0; i < 100 && cursor != ""; i++ {
		page := fetchHistoryPage(t, mgr, userID, pageSize, cursor)
		collected = append(collected, historyPageIDs(page)...)
		cursor = page.NextCursor
	}
	return collected
}

func fetchHistoryPage(t *testing.T, mgr *DailyManager, userID uuid.UUID, pageSize int, cursor string) HistoryPage {
	t.Helper()
	page, err := mgr.ListHistory(context.Background(), userID, HistoryQuery{Limit: pageSize, Cursor: cursor})
	if err != nil {
		t.Fatalf("ListHistory(limit=%d, cursor=%q) error = %v", pageSize, cursor, err)
	}
	if pageSize > 0 && len(page.Items) > pageSize {
		t.Fatalf("page returned %d items, want <= %d", len(page.Items), pageSize)
	}
	return page
}

func historyPageIDs(page HistoryPage) []uuid.UUID {
	ids := make([]uuid.UUID, len(page.Items))
	for i, item := range page.Items {
		ids[i] = item.ID
	}
	return ids
}

func assertHistoryOrder(t *testing.T, got, want []uuid.UUID) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("ids = %v, want %v", got, want)
	}
	seen := make(map[uuid.UUID]int, len(got))
	for i, rowID := range got {
		seen[rowID]++
		if rowID != want[i] {
			t.Fatalf("order at %d = %v, want %v (got %v)", i, rowID, want[i], got)
		}
	}
	for rowID, count := range seen {
		if count > 1 {
			t.Errorf("duplicate id %v in %v", rowID, got)
		}
	}
}

func TestDailyManager_ListRequiresProvisioning(t *testing.T) {
	store := &mockStore{
		userCacheExists: func(context.Context, pgtype.UUID) (bool, error) { return false, nil },
	}
	mgr := NewDailyManager(nil, nil, store)
	if _, err := mgr.List(context.Background(), uuid.New(), ListFilter{}); !errors.Is(err, ErrPlayerNotReady) {
		t.Fatalf("List() error = %v, want ErrPlayerNotReady", err)
	}
	if _, err := mgr.ListHistory(context.Background(), uuid.New(), HistoryQuery{}); !errors.Is(err, ErrPlayerNotReady) {
		t.Fatalf("ListHistory() error = %v, want ErrPlayerNotReady", err)
	}
	if _, err := mgr.Get(context.Background(), uuid.New(), uuid.New()); !errors.Is(err, ErrPlayerNotReady) {
		t.Fatalf("Get() error = %v, want ErrPlayerNotReady", err)
	}
}

func ptr[T any](value T) *T {
	return &value
}
