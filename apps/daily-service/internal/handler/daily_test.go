package handler

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/daily"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
	sharedhttptest "github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp/test"
)

type mockDailyManager struct {
	create   func(ctx context.Context, input daily.CreateInput) (daily.Daily, error)
	get      func(ctx context.Context, userID, id uuid.UUID) (daily.Daily, error)
	list     func(ctx context.Context, userID uuid.UUID, filter daily.ListFilter) ([]daily.Daily, error)
	update   func(ctx context.Context, userID, id uuid.UUID, input daily.UpdateInput) (daily.Daily, error)
	delete   func(ctx context.Context, userID, id uuid.UUID) error
	complete func(ctx context.Context, userID, id uuid.UUID) (daily.Daily, error)
}

func (m *mockDailyManager) Create(ctx context.Context, input daily.CreateInput) (daily.Daily, error) {
	if m.create != nil {
		return m.create(ctx, input)
	}
	return daily.Daily{}, errors.New("unexpected Create call")
}

func (m *mockDailyManager) Get(ctx context.Context, userID, id uuid.UUID) (daily.Daily, error) {
	if m.get != nil {
		return m.get(ctx, userID, id)
	}
	return daily.Daily{}, errors.New("unexpected Get call")
}

func (m *mockDailyManager) List(ctx context.Context, userID uuid.UUID, filter daily.ListFilter) ([]daily.Daily, error) {
	if m.list != nil {
		return m.list(ctx, userID, filter)
	}
	return nil, errors.New("unexpected List call")
}

func (m *mockDailyManager) Update(ctx context.Context, userID, id uuid.UUID, input daily.UpdateInput) (daily.Daily, error) {
	if m.update != nil {
		return m.update(ctx, userID, id, input)
	}
	return daily.Daily{}, errors.New("unexpected Update call")
}

func (m *mockDailyManager) Delete(ctx context.Context, userID, id uuid.UUID) error {
	if m.delete != nil {
		return m.delete(ctx, userID, id)
	}
	return errors.New("unexpected Delete call")
}

func (m *mockDailyManager) Complete(ctx context.Context, userID, id uuid.UUID) (daily.Daily, error) {
	if m.complete != nil {
		return m.complete(ctx, userID, id)
	}
	return daily.Daily{}, errors.New("unexpected Complete call")
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

func newTestDailyRouter(t *testing.T, manager dailyManager) (http.Handler, *testTokenSigner) {
	t.Helper()
	signer := newTestTokenSigner()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cache := auth.NewStaticJWKSCache(signer.kid, signer.priv.Public())
	authHandshake := sharedhttp.NewAuthHandshake(cache)
	h := NewDailyHandler(manager, authHandshake, logger)
	mux := http.NewServeMux()
	h.RegisterDailyRoutes(mux)
	return mux, signer
}

func TestCreateDaily(t *testing.T) {
	userID := uuid.New()
	dailyID := uuid.New()
	dueDate := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name           string
		body           string
		setupManager   func(m *mockDailyManager)
		wantStatus     int
		wantFieldError map[string]string
		wantErrorCode  string
		assertResponse func(t *testing.T, resp dailyResponse)
	}{
		{
			name: "creates daily",
			body: `{"title":"Explore Mars","description":"scan surface","difficulty":"MEDIUM","due_date":"2026-09-15T10:00:00Z"}`,
			setupManager: func(m *mockDailyManager) {
				m.create = func(ctx context.Context, input daily.CreateInput) (daily.Daily, error) {
					if input.UserID != userID {
						t.Errorf("user_id = %v, want %v", input.UserID, userID)
					}
					if input.Title != "Explore Mars" {
						t.Errorf("title = %q, want Explore Mars", input.Title)
					}
					if input.Description != "scan surface" {
						t.Errorf("description = %q, want scan surface", input.Description)
					}
					if input.Difficulty != "MEDIUM" {
						t.Errorf("difficulty = %q, want MEDIUM", input.Difficulty)
					}
					if !input.DueDate.Equal(dueDate) {
						t.Errorf("due_date = %v, want %v", input.DueDate, dueDate)
					}
					return daily.Daily{
						ID:          dailyID,
						UserID:      userID,
						Title:       "Explore Mars",
						Description: "scan surface",
						Difficulty:  "MEDIUM",
						DueDate:     dueDate,
						Status:      "PENDING",
						CreatedAt:   createdAt,
						UpdatedAt:   createdAt,
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
			name:           "invalid due_date format",
			body:           `{"title":"Explore Mars","difficulty":"MEDIUM","due_date":"not-a-date"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"due_date": "due_date must be a valid RFC3339 timestamp"},
		},
		{
			name:           "malformed JSON body",
			body:           `not valid json`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"body": "invalid JSON body"},
		},
		{
			name: "manager invalid difficulty error",
			body: `{"title":"Explore Mars","difficulty":"MEDIUM","due_date":"2026-09-15T10:00:00Z"}`,
			setupManager: func(m *mockDailyManager) {
				m.create = func(ctx context.Context, input daily.CreateInput) (daily.Daily, error) {
					return daily.Daily{}, daily.ErrInvalidDifficulty
				}
			},
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"difficulty": "must be one of: EASY, MEDIUM, HARD"},
		},
		{
			name: "manager error",
			body: `{"title":"Explore Mars","difficulty":"MEDIUM","due_date":"2026-09-15T10:00:00Z"}`,
			setupManager: func(m *mockDailyManager) {
				m.create = func(ctx context.Context, input daily.CreateInput) (daily.Daily, error) {
					return daily.Daily{}, errors.New("database down")
				}
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mgr := &mockDailyManager{}
			if tt.setupManager != nil {
				tt.setupManager(mgr)
			}

			router, signer := newTestDailyRouter(t, mgr)
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
	dailyID := uuid.New()
	dueDate := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name           string
		path           string
		setupManager   func(m *mockDailyManager)
		wantStatus     int
		wantErrorCode  string
		wantFieldError map[string]string
		assertResponse func(t *testing.T, resp []dailyResponse)
	}{
		{
			name: "returns dailies for user without filter",
			path: "/dailies",
			setupManager: func(m *mockDailyManager) {
				m.list = func(ctx context.Context, id uuid.UUID, filter daily.ListFilter) ([]daily.Daily, error) {
					if id != userID {
						t.Errorf("user_id = %v, want %v", id, userID)
					}
					if filter.Status != nil {
						t.Errorf("status filter = %v, want nil", *filter.Status)
					}
					if filter.Date != nil {
						t.Errorf("date filter = %v, want nil", *filter.Date)
					}
					return []daily.Daily{
						{
							ID:         dailyID,
							UserID:     userID,
							Title:      "Explore Mars",
							Difficulty: "EASY",
							DueDate:    dueDate,
							Status:     "PENDING",
							CreatedAt:  createdAt,
							UpdatedAt:  createdAt,
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
			name: "filters by status and date",
			path: "/dailies?status=PENDING&date=2026-09-15",
			setupManager: func(m *mockDailyManager) {
				m.list = func(ctx context.Context, id uuid.UUID, filter daily.ListFilter) ([]daily.Daily, error) {
					if id != userID {
						t.Errorf("user_id = %v, want %v", id, userID)
					}
					if filter.Status == nil || *filter.Status != "PENDING" {
						t.Errorf("status filter = %v, want PENDING", filter.Status)
					}
					wantDate := time.Date(2026, 9, 15, 0, 0, 0, 0, time.UTC)
					if filter.Date == nil || !filter.Date.Equal(wantDate) {
						t.Errorf("date filter = %v, want %v", filter.Date, wantDate)
					}
					return []daily.Daily{
						{
							ID:         dailyID,
							UserID:     userID,
							Title:      "Explore Mars",
							Difficulty: "EASY",
							DueDate:    dueDate,
							Status:     "PENDING",
							CreatedAt:  createdAt,
							UpdatedAt:  createdAt,
						},
					}, nil
				}
			},
			wantStatus: http.StatusOK,
			assertResponse: func(t *testing.T, resp []dailyResponse) {
				if len(resp) != 1 {
					t.Fatalf("len(dailies) = %d, want 1", len(resp))
				}
			},
		},
		{
			name:           "invalid date filter returns 422",
			path:           "/dailies?date=not-a-date",
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"date": "date must be YYYY-MM-DD or RFC3339"},
		},
		{
			name: "returns empty list",
			path: "/dailies",
			setupManager: func(m *mockDailyManager) {
				m.list = func(ctx context.Context, id uuid.UUID, filter daily.ListFilter) ([]daily.Daily, error) {
					if id != userID {
						t.Errorf("user_id = %v, want %v", id, userID)
					}
					return []daily.Daily{}, nil
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
			name: "manager error",
			path: "/dailies",
			setupManager: func(m *mockDailyManager) {
				m.list = func(ctx context.Context, id uuid.UUID, filter daily.ListFilter) ([]daily.Daily, error) {
					return nil, errors.New("database down")
				}
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mgr := &mockDailyManager{}
			if tt.setupManager != nil {
				tt.setupManager(mgr)
			}

			router, signer := newTestDailyRouter(t, mgr)
			rec := httptest.NewRecorder()
			path := tt.path
			if path == "" {
				path = "/dailies"
			}
			req := sharedhttptest.NewRequest(t, http.MethodGet, path, "")
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
				var resp []dailyResponse
				sharedhttptest.DecodeBody(t, rec, &resp)
				tt.assertResponse(t, resp)
			}
		})
	}
}

func TestGetDaily(t *testing.T) {
	userID := uuid.New()
	dailyID := uuid.New()
	dueDate := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name           string
		dailyID        string
		setupManager   func(m *mockDailyManager)
		wantStatus     int
		wantFieldError map[string]string
		wantErrorCode  string
		assertResponse func(t *testing.T, resp dailyResponse)
	}{
		{
			name:    "returns daily",
			dailyID: dailyID.String(),
			setupManager: func(m *mockDailyManager) {
				m.get = func(ctx context.Context, uID, dID uuid.UUID) (daily.Daily, error) {
					if dID != dailyID {
						t.Errorf("daily_id = %v, want %v", dID, dailyID)
					}
					if uID != userID {
						t.Errorf("user_id = %v, want %v", uID, userID)
					}
					return daily.Daily{
						ID:         dailyID,
						UserID:     userID,
						Title:      "Explore Mars",
						Difficulty: "HARD",
						DueDate:    dueDate,
						Status:     "PENDING",
						CreatedAt:  createdAt,
						UpdatedAt:  createdAt,
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
			setupManager: func(m *mockDailyManager) {
				m.get = func(ctx context.Context, uID, dID uuid.UUID) (daily.Daily, error) {
					return daily.Daily{}, daily.ErrDailyNotFound
				}
			},
			wantStatus:    http.StatusNotFound,
			wantErrorCode: "DAILY_NOT_FOUND",
		},
		{
			name:    "manager error",
			dailyID: dailyID.String(),
			setupManager: func(m *mockDailyManager) {
				m.get = func(ctx context.Context, uID, dID uuid.UUID) (daily.Daily, error) {
					return daily.Daily{}, errors.New("database down")
				}
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mgr := &mockDailyManager{}
			if tt.setupManager != nil {
				tt.setupManager(mgr)
			}

			router, signer := newTestDailyRouter(t, mgr)
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
	dailyID := uuid.New()
	dueDate := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	newDueDate := time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	updatedAt := time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name           string
		dailyID        string
		body           string
		setupManager   func(m *mockDailyManager)
		wantStatus     int
		wantFieldError map[string]string
		wantErrorCode  string
		assertResponse func(t *testing.T, resp dailyResponse)
	}{
		{
			name:    "updates title",
			dailyID: dailyID.String(),
			body:    `{"title":"Colonize Mars"}`,
			setupManager: func(m *mockDailyManager) {
				m.update = func(ctx context.Context, uID, dID uuid.UUID, input daily.UpdateInput) (daily.Daily, error) {
					if dID != dailyID {
						t.Errorf("daily_id = %v, want %v", dID, dailyID)
					}
					if uID != userID {
						t.Errorf("user_id = %v, want %v", uID, userID)
					}
					if input.Title == nil || *input.Title != "Colonize Mars" {
						t.Errorf("title = %v, want Colonize Mars", input.Title)
					}
					return daily.Daily{
						ID:          dailyID,
						UserID:      userID,
						Title:       "Colonize Mars",
						Difficulty:  "MEDIUM",
						DueDate:     dueDate,
						Status:      "PENDING",
						CreatedAt:   createdAt,
						UpdatedAt:   updatedAt,
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
			setupManager: func(m *mockDailyManager) {
				m.update = func(ctx context.Context, uID, dID uuid.UUID, input daily.UpdateInput) (daily.Daily, error) {
					if dID != dailyID {
						t.Errorf("daily_id = %v, want %v", dID, dailyID)
					}
					if uID != userID {
						t.Errorf("user_id = %v, want %v", uID, userID)
					}
					if input.DueDate == nil || !input.DueDate.Equal(newDueDate) {
						t.Errorf("due_date = %v, want %v", input.DueDate, newDueDate)
					}
					return daily.Daily{
						ID:          dailyID,
						UserID:      userID,
						Title:       "Explore Mars",
						Difficulty:  "MEDIUM",
						DueDate:     newDueDate,
						Status:      "PENDING",
						CreatedAt:   createdAt,
						UpdatedAt:   updatedAt,
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
			setupManager: func(m *mockDailyManager) {
				m.update = func(ctx context.Context, uID, dID uuid.UUID, input daily.UpdateInput) (daily.Daily, error) {
					return daily.Daily{}, daily.ErrDailyNotFound
				}
			},
			wantStatus:    http.StatusNotFound,
			wantErrorCode: "DAILY_NOT_FOUND",
		},
		{
			name:    "daily not pending",
			dailyID: dailyID.String(),
			body:    `{"title":"Colonize Mars"}`,
			setupManager: func(m *mockDailyManager) {
				m.update = func(ctx context.Context, uID, dID uuid.UUID, input daily.UpdateInput) (daily.Daily, error) {
					return daily.Daily{}, daily.ErrDailyNotPending
				}
			},
			wantStatus:    http.StatusConflict,
			wantErrorCode: "DAILY_NOT_EDITABLE",
		},
		{
			name:    "manager invalid difficulty error",
			dailyID: dailyID.String(),
			body:    `{"title":"Colonize Mars"}`,
			setupManager: func(m *mockDailyManager) {
				m.update = func(ctx context.Context, uID, dID uuid.UUID, input daily.UpdateInput) (daily.Daily, error) {
					return daily.Daily{}, daily.ErrInvalidDifficulty
				}
			},
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"difficulty": "must be one of: EASY, MEDIUM, HARD"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mgr := &mockDailyManager{}
			if tt.setupManager != nil {
				tt.setupManager(mgr)
			}

			router, signer := newTestDailyRouter(t, mgr)
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
	dailyID := uuid.New()

	tests := []struct {
		name           string
		dailyID        string
		setupManager   func(m *mockDailyManager)
		wantStatus     int
		wantFieldError map[string]string
		wantErrorCode  string
	}{
		{
			name:    "deletes daily",
			dailyID: dailyID.String(),
			setupManager: func(m *mockDailyManager) {
				m.delete = func(ctx context.Context, uID, dID uuid.UUID) error {
					if dID != dailyID {
						t.Errorf("daily_id = %v, want %v", dID, dailyID)
					}
					if uID != userID {
						t.Errorf("user_id = %v, want %v", uID, userID)
					}
					return nil
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
			setupManager: func(m *mockDailyManager) {
				m.delete = func(ctx context.Context, uID, dID uuid.UUID) error {
					return daily.ErrDailyNotFound
				}
			},
			wantStatus:    http.StatusNotFound,
			wantErrorCode: "DAILY_NOT_FOUND",
		},
		{
			name:    "daily not pending",
			dailyID: dailyID.String(),
			setupManager: func(m *mockDailyManager) {
				m.delete = func(ctx context.Context, uID, dID uuid.UUID) error {
					return daily.ErrDailyNotPending
				}
			},
			wantStatus:    http.StatusConflict,
			wantErrorCode: "DAILY_NOT_EDITABLE",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mgr := &mockDailyManager{}
			if tt.setupManager != nil {
				tt.setupManager(mgr)
			}

			router, signer := newTestDailyRouter(t, mgr)
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
	dailyID := uuid.New()
	dueDate := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name           string
		dailyID        string
		setupManager   func(m *mockDailyManager)
		wantStatus     int
		wantErrorCode  string
		assertResponse func(t *testing.T, resp dailyResponse)
	}{
		{
			name:    "completes daily",
			dailyID: dailyID.String(),
			setupManager: func(m *mockDailyManager) {
				m.complete = func(ctx context.Context, uID, dID uuid.UUID) (daily.Daily, error) {
					if dID != dailyID {
						t.Errorf("daily_id = %v, want %v", dID, dailyID)
					}
					if uID != userID {
						t.Errorf("user_id = %v, want %v", uID, userID)
					}
					return daily.Daily{
						ID:         dailyID,
						UserID:     userID,
						Title:      "Explore Mars",
						Difficulty: "HARD",
						Status:     "COMPLETED",
						DueDate:    dueDate,
						CreatedAt:  createdAt,
						UpdatedAt:  createdAt,
					}, nil
				}
			},
			wantStatus: http.StatusOK,
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
				if resp.Difficulty != "HARD" {
					t.Errorf("difficulty = %q, want HARD", resp.Difficulty)
				}
				if resp.Status != "COMPLETED" {
					t.Errorf("status = %q, want COMPLETED", resp.Status)
				}
			},
		},
		{
			name:    "returns 404 if daily not found",
			dailyID: dailyID.String(),
			setupManager: func(m *mockDailyManager) {
				m.complete = func(ctx context.Context, uID, dID uuid.UUID) (daily.Daily, error) {
					return daily.Daily{}, daily.ErrDailyNotFound
				}
			},
			wantStatus:    http.StatusNotFound,
			wantErrorCode: "DAILY_NOT_FOUND",
		},
		{
			name:    "returns 409 if already completed",
			dailyID: dailyID.String(),
			setupManager: func(m *mockDailyManager) {
				m.complete = func(ctx context.Context, uID, dID uuid.UUID) (daily.Daily, error) {
					return daily.Daily{}, daily.ErrDailyAlreadyCompleted
				}
			},
			wantStatus:    http.StatusConflict,
			wantErrorCode: "DAILY_ALREADY_COMPLETED",
		},
		{
			name:    "returns 409 if not pending (missed)",
			dailyID: dailyID.String(),
			setupManager: func(m *mockDailyManager) {
				m.complete = func(ctx context.Context, uID, dID uuid.UUID) (daily.Daily, error) {
					return daily.Daily{}, daily.ErrDailyNotPending
				}
			},
			wantStatus:    http.StatusConflict,
			wantErrorCode: "DAILY_ALREADY_COMPLETED",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			mgr := &mockDailyManager{}
			if tc.setupManager != nil {
				tc.setupManager(mgr)
			}

			router, signer := newTestDailyRouter(t, mgr)
			rec := httptest.NewRecorder()
			req := sharedhttptest.NewRequest(t, http.MethodPost, "/dailies/"+tc.dailyID+"/complete", "")
			req.Header.Set("Authorization", "Bearer "+signer.Token(userID.String()))

			router.ServeHTTP(rec, req)

			sharedhttptest.WantStatus(t, rec, tc.wantStatus)

			if tc.wantErrorCode != "" {
				sharedhttptest.WantErrorCode(t, rec, tc.wantErrorCode)
				return
			}

			if tc.assertResponse != nil {
				var resp dailyResponse
				sharedhttptest.DecodeBody(t, rec, &resp)
				tc.assertResponse(t, resp)
			}
		})
	}
}
