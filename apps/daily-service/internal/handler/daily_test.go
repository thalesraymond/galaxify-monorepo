package handler

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
	sharedhttptest "github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp/test"
)

type mockDailyStore struct {
	createDaily func(ctx context.Context, arg database.CreateDailyParams) (database.Daily, error)
	listDailies func(ctx context.Context, userID pgtype.UUID) ([]database.Daily, error)
	getDaily    func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error)
	updateDaily func(ctx context.Context, arg database.UpdateDailyParams) (database.Daily, error)
	deleteDaily func(ctx context.Context, arg database.DeleteDailyParams) (int64, error)
	markDailyComplete func(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error)
	getDifficultyReward func(ctx context.Context, difficulty string) (database.DifficultyReward, error)
}

func (m *mockDailyStore) CreateDaily(ctx context.Context, arg database.CreateDailyParams) (database.Daily, error) {
	if m.createDaily != nil {
		return m.createDaily(ctx, arg)
	}
	return database.Daily{}, errors.New("unexpected CreateDaily call")
}

func (m *mockDailyStore) ListDailies(ctx context.Context, userID pgtype.UUID) ([]database.Daily, error) {
	if m.listDailies != nil {
		return m.listDailies(ctx, userID)
	}
	return nil, errors.New("unexpected ListDailies call")
}

func (m *mockDailyStore) GetDaily(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
	if m.getDaily != nil {
		return m.getDaily(ctx, arg)
	}
	return database.Daily{}, errors.New("unexpected GetDaily call")
}

func (m *mockDailyStore) UpdateDaily(ctx context.Context, arg database.UpdateDailyParams) (database.Daily, error) {
	if m.updateDaily != nil {
		return m.updateDaily(ctx, arg)
	}
	return database.Daily{}, errors.New("unexpected UpdateDaily call")
}

func (m *mockDailyStore) DeleteDaily(ctx context.Context, arg database.DeleteDailyParams) (int64, error) {
	if m.deleteDaily != nil {
		return m.deleteDaily(ctx, arg)
	}
	return 0, errors.New("unexpected DeleteDaily call")
}

func (m *mockDailyStore) MarkDailyComplete(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error) {
	if m.markDailyComplete != nil {
		return m.markDailyComplete(ctx, arg)
	}
	return database.Daily{}, errors.New("unexpected MarkDailyComplete call")
}

func (m *mockDailyStore) GetDifficultyReward(ctx context.Context, difficulty string) (database.DifficultyReward, error) {
	if m.getDifficultyReward != nil {
		return m.getDifficultyReward(ctx, difficulty)
	}
	return database.DifficultyReward{}, errors.New("unexpected GetDifficultyReward call")
}

type mockEventPublisher struct {
	publish func(ctx context.Context, eventType string, payload any) error
}

func (m *mockEventPublisher) Publish(ctx context.Context, eventType string, payload any) error {
	if m.publish != nil {
		return m.publish(ctx, eventType, payload)
	}
	return errors.New("unexpected Publish call")
}

type testTokenSigner struct {
	kid  string
	priv ed25519.PrivateKey
}

func newTestTokenSigner() *testTokenSigner {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		panic(err)
	}
	return &testTokenSigner{kid: "test-kid", priv: priv}
}

func (s *testTokenSigner) Token(userID string) string {
	token, err := auth.IssueAccessToken(s.priv, s.kid, userID, "")
	if err != nil {
		panic(err)
	}
	return token
}

func newTestDailyRouter(t *testing.T, store dailyStore, publisher EventPublisher) (http.Handler, *testTokenSigner) {
	t.Helper()
	signer := newTestTokenSigner()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cache := auth.NewStaticJWKSCache(signer.kid, signer.priv.Public())
	authHandshake := sharedhttp.NewAuthHandshake(cache)
	h := NewDailyHandler(store, publisher, authHandshake, logger)
	mux := http.NewServeMux()
	h.RegisterDailyRoutes(mux)
	return mux, signer
}

func TestCreateDaily(t *testing.T) {
	userID := uuid.New()
	pgUserID := pgtype.UUID{Bytes: userID, Valid: true}
	dailyID := uuid.New()
	dueDate := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name           string
		body           string
		setupStore     func(m *mockDailyStore)
		wantStatus     int
		wantFieldError map[string]string
		wantErrorCode  string
		assertResponse func(t *testing.T, resp dailyResponse)
	}{
		{
			name: "creates daily",
			body: `{"title":"Explore Mars","description":"scan surface","difficulty":"MEDIUM","due_date":"2026-09-15T10:00:00Z"}`,
			setupStore: func(m *mockDailyStore) {
				m.createDaily = func(ctx context.Context, arg database.CreateDailyParams) (database.Daily, error) {
					if arg.UserID != pgUserID {
						t.Errorf("user_id = %v, want %v", arg.UserID, pgUserID)
					}
					if arg.Title != "Explore Mars" {
						t.Errorf("title = %q, want Explore Mars", arg.Title)
					}
					if arg.Description != "scan surface" {
						t.Errorf("description = %q, want scan surface", arg.Description)
					}
					if arg.Difficulty != "MEDIUM" {
						t.Errorf("difficulty = %q, want MEDIUM", arg.Difficulty)
					}
					if !arg.DueDate.Valid || !arg.DueDate.Time.Equal(dueDate) {
						t.Errorf("due_date = %v, want %v", arg.DueDate, dueDate)
					}
					return database.Daily{
						ID:          pgtype.UUID{Bytes: dailyID, Valid: true},
						UserID:      pgUserID,
						Title:       "Explore Mars",
						Description: "scan surface",
						Difficulty:  "MEDIUM",
						DueDate:     pgtype.Timestamptz{Time: dueDate, Valid: true},
						Status:      "PENDING",
						CreatedAt:   pgtype.Timestamptz{Time: createdAt, Valid: true},
						UpdatedAt:   pgtype.Timestamptz{Time: createdAt, Valid: true},
					}, nil
				}
			},
			wantStatus: http.StatusCreated,
			assertResponse: func(t *testing.T, resp dailyResponse) {
				if resp.ID != dailyID.String() {
					t.Errorf("id = %q, want %q", resp.ID, dailyID.String())
				}
				if resp.UserID != userID.String() {
					t.Errorf("user_id = %q, want %q", resp.UserID, userID.String())
				}
				if resp.Title != "Explore Mars" {
					t.Errorf("title = %q, want Explore Mars", resp.Title)
				}
				if resp.Difficulty != "MEDIUM" {
					t.Errorf("difficulty = %q, want MEDIUM", resp.Difficulty)
				}
				if resp.Status != "PENDING" {
					t.Errorf("status = %q, want PENDING", resp.Status)
				}
			},
		},
		{
			name:           "missing title",
			body:           `{"description":"scan surface","difficulty":"MEDIUM","due_date":"2026-09-15T10:00:00Z"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"title": "title is required"},
		},
		{
			name:           "invalid difficulty",
			body:           `{"title":"Explore Mars","difficulty":"EXTREME","due_date":"2026-09-15T10:00:00Z"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"difficulty": "must be one of: EASY, MEDIUM, HARD"},
		},
		{
			name:           "invalid due_date",
			body:           `{"title":"Explore Mars","difficulty":"MEDIUM","due_date":"tomorrow"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"due_date": "due_date must be a valid RFC3339 timestamp"},
		},
		{
			name: "store error",
			body: `{"title":"Explore Mars","difficulty":"MEDIUM","due_date":"2026-09-15T10:00:00Z"}`,
			setupStore: func(m *mockDailyStore) {
				m.createDaily = func(ctx context.Context, arg database.CreateDailyParams) (database.Daily, error) {
					return database.Daily{}, errors.New("database down")
				}
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &mockDailyStore{}
			if tt.setupStore != nil {
				tt.setupStore(store)
			}

			router, signer := newTestDailyRouter(t, store, &mockEventPublisher{})
			rec := httptest.NewRecorder()
			req := sharedhttptest.NewRequest(t, http.MethodPost, "/dailies", tt.body)
			req.Header.Set("Authorization", "Bearer "+signer.Token(userID.String()))

			router.ServeHTTP(rec, req)

			sharedhttptest.WantStatus(t, rec, tt.wantStatus)

			if tt.wantFieldError != nil {
				for field, wantMessage := range tt.wantFieldError {
					sharedhttptest.WantFieldError(t, rec, field, wantMessage)
				}
				return
			}

			if tt.wantErrorCode != "" {
				sharedhttptest.WantErrorCode(t, rec, tt.wantErrorCode)
				return
			}

			if tt.assertResponse != nil {
				var resp dailyResponse
				sharedhttptest.DecodeBody(t, rec, &resp)
				tt.assertResponse(t, resp)
			}
		})
	}
}

func TestListDailies(t *testing.T) {
	userID := uuid.New()
	pgUserID := pgtype.UUID{Bytes: userID, Valid: true}
	dailyID := uuid.New()
	dueDate := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name           string
		setupStore     func(m *mockDailyStore)
		wantStatus     int
		wantErrorCode  string
		assertResponse func(t *testing.T, resp []dailyResponse)
	}{
		{
			name: "returns dailies for user",
			setupStore: func(m *mockDailyStore) {
				m.listDailies = func(ctx context.Context, id pgtype.UUID) ([]database.Daily, error) {
					if id != pgUserID {
						t.Errorf("user_id = %v, want %v", id, pgUserID)
					}
					return []database.Daily{
						{
							ID:         pgtype.UUID{Bytes: dailyID, Valid: true},
							UserID:     pgUserID,
							Title:      "Explore Mars",
							Difficulty: "EASY",
							DueDate:    pgtype.Timestamptz{Time: dueDate, Valid: true},
							Status:     "PENDING",
							CreatedAt:  pgtype.Timestamptz{Time: createdAt, Valid: true},
							UpdatedAt:  pgtype.Timestamptz{Time: createdAt, Valid: true},
						},
					}, nil
				}
			},
			wantStatus: http.StatusOK,
			assertResponse: func(t *testing.T, resp []dailyResponse) {
				if len(resp) != 1 {
					t.Fatalf("len(dailies) = %d, want 1", len(resp))
				}
				if resp[0].ID != dailyID.String() {
					t.Errorf("id = %q, want %q", resp[0].ID, dailyID.String())
				}
				if resp[0].Title != "Explore Mars" {
					t.Errorf("title = %q, want Explore Mars", resp[0].Title)
				}
			},
		},
		{
			name: "returns empty list",
			setupStore: func(m *mockDailyStore) {
				m.listDailies = func(ctx context.Context, id pgtype.UUID) ([]database.Daily, error) {
					return []database.Daily{}, nil
				}
			},
			wantStatus: http.StatusOK,
			assertResponse: func(t *testing.T, resp []dailyResponse) {
				if len(resp) != 0 {
					t.Errorf("len(dailies) = %d, want 0", len(resp))
				}
			},
		},
		{
			name: "store error",
			setupStore: func(m *mockDailyStore) {
				m.listDailies = func(ctx context.Context, id pgtype.UUID) ([]database.Daily, error) {
					return nil, errors.New("database down")
				}
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &mockDailyStore{}
			if tt.setupStore != nil {
				tt.setupStore(store)
			}

			router, signer := newTestDailyRouter(t, store, &mockEventPublisher{})
			rec := httptest.NewRecorder()
			req := sharedhttptest.NewRequest(t, http.MethodGet, "/dailies", "")
			req.Header.Set("Authorization", "Bearer "+signer.Token(userID.String()))

			router.ServeHTTP(rec, req)

			sharedhttptest.WantStatus(t, rec, tt.wantStatus)

			if tt.wantErrorCode != "" {
				sharedhttptest.WantErrorCode(t, rec, tt.wantErrorCode)
				return
			}

			if tt.assertResponse != nil {
				var resp []dailyResponse
				sharedhttptest.DecodeBody(t, rec, &resp)
				tt.assertResponse(t, resp)
			}
		})
	}
}

func TestGetDaily(t *testing.T) {
	userID := uuid.New()
	pgUserID := pgtype.UUID{Bytes: userID, Valid: true}
	dailyID := uuid.New()
	pgDailyID := pgtype.UUID{Bytes: dailyID, Valid: true}
	dueDate := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name           string
		dailyID        string
		setupStore     func(m *mockDailyStore)
		wantStatus     int
		wantFieldError map[string]string
		wantErrorCode  string
		assertResponse func(t *testing.T, resp dailyResponse)
	}{
		{
			name:    "returns daily",
			dailyID: dailyID.String(),
			setupStore: func(m *mockDailyStore) {
				m.getDaily = func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
					if arg.ID != pgDailyID {
						t.Errorf("daily_id = %v, want %v", arg.ID, pgDailyID)
					}
					if arg.UserID != pgUserID {
						t.Errorf("user_id = %v, want %v", arg.UserID, pgUserID)
					}
					return database.Daily{
						ID:         pgDailyID,
						UserID:     pgUserID,
						Title:      "Explore Mars",
						Difficulty: "HARD",
						DueDate:    pgtype.Timestamptz{Time: dueDate, Valid: true},
						Status:     "PENDING",
						CreatedAt:  pgtype.Timestamptz{Time: createdAt, Valid: true},
						UpdatedAt:  pgtype.Timestamptz{Time: createdAt, Valid: true},
					}, nil
				}
			},
			wantStatus: http.StatusOK,
			assertResponse: func(t *testing.T, resp dailyResponse) {
				if resp.ID != dailyID.String() {
					t.Errorf("id = %q, want %q", resp.ID, dailyID.String())
				}
				if resp.Title != "Explore Mars" {
					t.Errorf("title = %q, want Explore Mars", resp.Title)
				}
			},
		},
		{
			name:           "invalid id",
			dailyID:        "not-a-uuid",
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"id": "invalid UUID"},
		},
		{
			name:    "not found",
			dailyID: dailyID.String(),
			setupStore: func(m *mockDailyStore) {
				m.getDaily = func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
					return database.Daily{}, pgx.ErrNoRows
				}
			},
			wantStatus:    http.StatusNotFound,
			wantErrorCode: "DAILY_NOT_FOUND",
		},
		{
			name:    "store error",
			dailyID: dailyID.String(),
			setupStore: func(m *mockDailyStore) {
				m.getDaily = func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
					return database.Daily{}, errors.New("database down")
				}
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &mockDailyStore{}
			if tt.setupStore != nil {
				tt.setupStore(store)
			}

			router, signer := newTestDailyRouter(t, store, &mockEventPublisher{})
			rec := httptest.NewRecorder()
			req := sharedhttptest.NewRequest(t, http.MethodGet, "/dailies/"+tt.dailyID, "")
			req.Header.Set("Authorization", "Bearer "+signer.Token(userID.String()))

			router.ServeHTTP(rec, req)

			sharedhttptest.WantStatus(t, rec, tt.wantStatus)

			if tt.wantFieldError != nil {
				for field, wantMessage := range tt.wantFieldError {
					sharedhttptest.WantFieldError(t, rec, field, wantMessage)
				}
				return
			}

			if tt.wantErrorCode != "" {
				sharedhttptest.WantErrorCode(t, rec, tt.wantErrorCode)
				return
			}

			if tt.assertResponse != nil {
				var resp dailyResponse
				sharedhttptest.DecodeBody(t, rec, &resp)
				tt.assertResponse(t, resp)
			}
		})
	}
}

func TestUpdateDaily(t *testing.T) {
	userID := uuid.New()
	pgUserID := pgtype.UUID{Bytes: userID, Valid: true}
	dailyID := uuid.New()
	pgDailyID := pgtype.UUID{Bytes: dailyID, Valid: true}
	dueDate := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	newDueDate := time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	updatedAt := time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)

	pendingDaily := database.Daily{
		ID:         pgDailyID,
		UserID:     pgUserID,
		Title:      "Explore Mars",
		Difficulty: "MEDIUM",
		DueDate:    pgtype.Timestamptz{Time: dueDate, Valid: true},
		Status:     "PENDING",
		CreatedAt:  pgtype.Timestamptz{Time: createdAt, Valid: true},
		UpdatedAt:  pgtype.Timestamptz{Time: createdAt, Valid: true},
	}

	tests := []struct {
		name           string
		dailyID        string
		body           string
		setupStore     func(m *mockDailyStore)
		wantStatus     int
		wantFieldError map[string]string
		wantErrorCode  string
		assertResponse func(t *testing.T, resp dailyResponse)
	}{
		{
			name:    "updates title",
			dailyID: dailyID.String(),
			body:    `{"title":"Colonize Mars"}`,
			setupStore: func(m *mockDailyStore) {
				m.getDaily = func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
					return pendingDaily, nil
				}
				m.updateDaily = func(ctx context.Context, arg database.UpdateDailyParams) (database.Daily, error) {
					if arg.ID != pgDailyID {
						t.Errorf("daily_id = %v, want %v", arg.ID, pgDailyID)
					}
					if arg.UserID != pgUserID {
						t.Errorf("user_id = %v, want %v", arg.UserID, pgUserID)
					}
					if !arg.Title.Valid || arg.Title.String != "Colonize Mars" {
						t.Errorf("title = %v, want Colonize Mars", arg.Title)
					}
					if arg.Description.Valid {
						t.Error("description should not be set")
					}
					return database.Daily{
						ID:         pgDailyID,
						UserID:     pgUserID,
						Title:      "Colonize Mars",
						Difficulty: "MEDIUM",
						DueDate:    pgtype.Timestamptz{Time: dueDate, Valid: true},
						Status:     "PENDING",
						CreatedAt:  pgtype.Timestamptz{Time: createdAt, Valid: true},
						UpdatedAt:  pgtype.Timestamptz{Time: updatedAt, Valid: true},
					}, nil
				}
			},
			wantStatus: http.StatusOK,
			assertResponse: func(t *testing.T, resp dailyResponse) {
				if resp.Title != "Colonize Mars" {
					t.Errorf("title = %q, want Colonize Mars", resp.Title)
				}
			},
		},
		{
			name:    "updates due_date",
			dailyID: dailyID.String(),
			body:    `{"due_date":"2026-09-20T10:00:00Z"}`,
			setupStore: func(m *mockDailyStore) {
				m.getDaily = func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
					return pendingDaily, nil
				}
				m.updateDaily = func(ctx context.Context, arg database.UpdateDailyParams) (database.Daily, error) {
					if !arg.DueDate.Valid || !arg.DueDate.Time.Equal(newDueDate) {
						t.Errorf("due_date = %v, want %v", arg.DueDate, newDueDate)
					}
					return database.Daily{
						ID:         pgDailyID,
						UserID:     pgUserID,
						Title:      "Explore Mars",
						Difficulty: "MEDIUM",
						DueDate:    pgtype.Timestamptz{Time: newDueDate, Valid: true},
						Status:     "PENDING",
						CreatedAt:  pgtype.Timestamptz{Time: createdAt, Valid: true},
						UpdatedAt:  pgtype.Timestamptz{Time: updatedAt, Valid: true},
					}, nil
				}
			},
			wantStatus: http.StatusOK,
			assertResponse: func(t *testing.T, resp dailyResponse) {
				if resp.DueDate != "2026-09-20T10:00:00Z" {
					t.Errorf("due_date = %q, want 2026-09-20T10:00:00Z", resp.DueDate)
				}
			},
		},
		{
			name:           "invalid id",
			dailyID:        "not-a-uuid",
			body:           `{"title":"Colonize Mars"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"id": "invalid UUID"},
		},
		{
			name:    "not found",
			dailyID: dailyID.String(),
			body:    `{"title":"Colonize Mars"}`,
			setupStore: func(m *mockDailyStore) {
				m.getDaily = func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
					return database.Daily{}, pgx.ErrNoRows
				}
			},
			wantStatus:    http.StatusNotFound,
			wantErrorCode: "DAILY_NOT_FOUND",
		},
		{
			name:    "not editable",
			dailyID: dailyID.String(),
			body:    `{"title":"Colonize Mars"}`,
			setupStore: func(m *mockDailyStore) {
				m.getDaily = func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
					return database.Daily{
						ID:         pgDailyID,
						UserID:     pgUserID,
						Title:      "Explore Mars",
						Difficulty: "MEDIUM",
						DueDate:    pgtype.Timestamptz{Time: dueDate, Valid: true},
						Status:     "COMPLETED",
						CreatedAt:  pgtype.Timestamptz{Time: createdAt, Valid: true},
						UpdatedAt:  pgtype.Timestamptz{Time: createdAt, Valid: true},
					}, nil
				}
			},
			wantStatus:    http.StatusConflict,
			wantErrorCode: "DAILY_NOT_EDITABLE",
		},
		{
			name:           "invalid difficulty",
			dailyID:        dailyID.String(),
			body:           `{"difficulty":"HARDER"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"difficulty": "must be one of: EASY, MEDIUM, HARD"},
		},
		{
			name:           "invalid due_date",
			dailyID:        dailyID.String(),
			body:           `{"due_date":"bad"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"due_date": "due_date must be a valid RFC3339 timestamp"},
		},
		{
			name:    "store error on update",
			dailyID: dailyID.String(),
			body:    `{"title":"Colonize Mars"}`,
			setupStore: func(m *mockDailyStore) {
				m.getDaily = func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
					return pendingDaily, nil
				}
				m.updateDaily = func(ctx context.Context, arg database.UpdateDailyParams) (database.Daily, error) {
					return database.Daily{}, errors.New("database down")
				}
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &mockDailyStore{}
			if tt.setupStore != nil {
				tt.setupStore(store)
			}

			router, signer := newTestDailyRouter(t, store, &mockEventPublisher{})
			rec := httptest.NewRecorder()
			req := sharedhttptest.NewRequest(t, http.MethodPatch, "/dailies/"+tt.dailyID, tt.body)
			req.Header.Set("Authorization", "Bearer "+signer.Token(userID.String()))

			router.ServeHTTP(rec, req)

			sharedhttptest.WantStatus(t, rec, tt.wantStatus)

			if tt.wantFieldError != nil {
				for field, wantMessage := range tt.wantFieldError {
					sharedhttptest.WantFieldError(t, rec, field, wantMessage)
				}
				return
			}

			if tt.wantErrorCode != "" {
				sharedhttptest.WantErrorCode(t, rec, tt.wantErrorCode)
				return
			}

			if tt.assertResponse != nil {
				var resp dailyResponse
				sharedhttptest.DecodeBody(t, rec, &resp)
				tt.assertResponse(t, resp)
			}
		})
	}
}

func TestDeleteDaily(t *testing.T) {
	userID := uuid.New()
	pgUserID := pgtype.UUID{Bytes: userID, Valid: true}
	dailyID := uuid.New()
	pgDailyID := pgtype.UUID{Bytes: dailyID, Valid: true}
	dueDate := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

	pendingDaily := database.Daily{
		ID:         pgDailyID,
		UserID:     pgUserID,
		Title:      "Explore Mars",
		Difficulty: "MEDIUM",
		DueDate:    pgtype.Timestamptz{Time: dueDate, Valid: true},
		Status:     "PENDING",
		CreatedAt:  pgtype.Timestamptz{Time: createdAt, Valid: true},
		UpdatedAt:  pgtype.Timestamptz{Time: createdAt, Valid: true},
	}

	tests := []struct {
		name           string
		dailyID        string
		setupStore     func(m *mockDailyStore)
		wantStatus     int
		wantFieldError map[string]string
		wantErrorCode  string
	}{
		{
			name:    "deletes daily",
			dailyID: dailyID.String(),
			setupStore: func(m *mockDailyStore) {
				m.getDaily = func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
					return pendingDaily, nil
				}
				m.deleteDaily = func(ctx context.Context, arg database.DeleteDailyParams) (int64, error) {
					if arg.ID != pgDailyID {
						t.Errorf("daily_id = %v, want %v", arg.ID, pgDailyID)
					}
					if arg.UserID != pgUserID {
						t.Errorf("user_id = %v, want %v", arg.UserID, pgUserID)
					}
					return 1, nil
				}
			},
			wantStatus: http.StatusNoContent,
		},
		{
			name:           "invalid id",
			dailyID:        "not-a-uuid",
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"id": "invalid UUID"},
		},
		{
			name:    "not found",
			dailyID: dailyID.String(),
			setupStore: func(m *mockDailyStore) {
				m.getDaily = func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
					return database.Daily{}, pgx.ErrNoRows
				}
			},
			wantStatus:    http.StatusNotFound,
			wantErrorCode: "DAILY_NOT_FOUND",
		},
		{
			name:    "not editable",
			dailyID: dailyID.String(),
			setupStore: func(m *mockDailyStore) {
				m.getDaily = func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
					return database.Daily{
						ID:         pgDailyID,
						UserID:     pgUserID,
						Title:      "Explore Mars",
						Difficulty: "MEDIUM",
						DueDate:    pgtype.Timestamptz{Time: dueDate, Valid: true},
						Status:     "MISSED",
						CreatedAt:  pgtype.Timestamptz{Time: createdAt, Valid: true},
						UpdatedAt:  pgtype.Timestamptz{Time: createdAt, Valid: true},
					}, nil
				}
			},
			wantStatus:    http.StatusConflict,
			wantErrorCode: "DAILY_NOT_EDITABLE",
		},
		{
			name:    "store error",
			dailyID: dailyID.String(),
			setupStore: func(m *mockDailyStore) {
				m.getDaily = func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
					return pendingDaily, nil
				}
				m.deleteDaily = func(ctx context.Context, arg database.DeleteDailyParams) (int64, error) {
					return 0, errors.New("database down")
				}
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &mockDailyStore{}
			if tt.setupStore != nil {
				tt.setupStore(store)
			}

			router, signer := newTestDailyRouter(t, store, &mockEventPublisher{})
			rec := httptest.NewRecorder()
			req := sharedhttptest.NewRequest(t, http.MethodDelete, "/dailies/"+tt.dailyID, "")
			req.Header.Set("Authorization", "Bearer "+signer.Token(userID.String()))

			router.ServeHTTP(rec, req)

			sharedhttptest.WantStatus(t, rec, tt.wantStatus)

			if tt.wantFieldError != nil {
				for field, wantMessage := range tt.wantFieldError {
					sharedhttptest.WantFieldError(t, rec, field, wantMessage)
				}
				return
			}

			if tt.wantErrorCode != "" {
				sharedhttptest.WantErrorCode(t, rec, tt.wantErrorCode)
				return
			}
		})
	}
}
func TestCompleteDaily(t *testing.T) {
	userID := uuid.New()
	pgUserID := pgtype.UUID{Bytes: userID, Valid: true}
	dailyID := uuid.New()
	pgDailyID := pgtype.UUID{Bytes: dailyID, Valid: true}
	dueDate := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name           string
		setupStore     func(m *mockDailyStore)
		setupPublisher func(m *mockEventPublisher)
		wantStatus     int
		wantErrorCode  string
	}{
		{
			name: "completes daily",
			setupStore: func(m *mockDailyStore) {
				m.getDaily = func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
					return database.Daily{
						ID:         pgDailyID,
						UserID:     pgUserID,
						Status:     "PENDING",
						Difficulty: "HARD",
					}, nil
				}
				m.markDailyComplete = func(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error) {
					return database.Daily{
						ID:          pgDailyID,
						UserID:      pgUserID,
						Difficulty:  "HARD",
						Status:      "COMPLETED",
						DueDate:     pgtype.Timestamptz{Time: dueDate, Valid: true},
						CreatedAt:   pgtype.Timestamptz{Time: createdAt, Valid: true},
						UpdatedAt:   pgtype.Timestamptz{Time: createdAt, Valid: true},
					}, nil
				}
				m.getDifficultyReward = func(ctx context.Context, difficulty string) (database.DifficultyReward, error) {
					return database.DifficultyReward{
						Difficulty:      "HARD",
						RewardMaterials: 30,
						DamageAmount:    20,
					}, nil
				}
			},
			setupPublisher: func(m *mockEventPublisher) {
				m.publish = func(ctx context.Context, eventType string, payload any) error {
					if eventType != "daily.completed" {
						t.Errorf("expected daily.completed, got %v", eventType)
					}
					ev := payload.(events.DailyCompleted)
					if ev.UserID != sharedhttp.UUIDToString(pgUserID) {
						t.Errorf("expected userID %v, got %v", sharedhttp.UUIDToString(pgUserID), ev.UserID)
					}
					if ev.RewardMaterials != 30 {
						t.Errorf("expected reward 30, got %v", ev.RewardMaterials)
					}
					return nil
				}
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "returns 409 if already completed",
			setupStore: func(m *mockDailyStore) {
				m.getDaily = func(ctx context.Context, arg database.GetDailyParams) (database.Daily, error) {
					return database.Daily{
						ID:     pgDailyID,
						UserID: pgUserID,
						Status: "COMPLETED",
					}, nil
				}
			},
			setupPublisher: func(m *mockEventPublisher) {
				m.publish = func(ctx context.Context, eventType string, payload any) error {
					return errors.New("should not be called")
				}
			},
			wantStatus:    http.StatusConflict,
			wantErrorCode: "DAILY_ALREADY_COMPLETED",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			store := &mockDailyStore{}
			if tc.setupStore != nil {
				tc.setupStore(store)
			}
			publisher := &mockEventPublisher{}
			if tc.setupPublisher != nil {
				tc.setupPublisher(publisher)
			}

			mux, signer := newTestDailyRouter(t, store, publisher)

			req := httptest.NewRequest(http.MethodPost, "/dailies/"+dailyID.String()+"/complete", nil)
			req.Header.Set("Authorization", "Bearer "+signer.Token(userID.String()))
			w := httptest.NewRecorder()

			mux.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d\nbody: %s", w.Code, tc.wantStatus, w.Body.String())
			}

			if tc.wantErrorCode != "" {
				var errResp struct {
					Error struct {
						Code string `json:"code"`
					} `json:"error"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &errResp); err != nil {
					t.Fatalf("failed to decode error response: %v", err)
				}
				if errResp.Error.Code != tc.wantErrorCode {
					t.Errorf("error code = %q, want %q", errResp.Error.Code, tc.wantErrorCode)
				}
			}
		})
	}
}
