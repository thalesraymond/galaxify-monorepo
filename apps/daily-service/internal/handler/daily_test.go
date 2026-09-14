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
	create      func(ctx context.Context, input daily.CreateInput) (daily.Daily, error)
	get         func(ctx context.Context, userID, id uuid.UUID) (daily.Daily, error)
	list        func(ctx context.Context, userID uuid.UUID, filter daily.ListFilter) ([]daily.Daily, error)
	update      func(ctx context.Context, userID, id uuid.UUID, input daily.UpdateInput) (daily.Daily, error)
	delete      func(ctx context.Context, userID, id uuid.UUID) error
	complete    func(ctx context.Context, userID, id uuid.UUID) (daily.Daily, error)
	listHistory func(ctx context.Context, userID uuid.UUID, query daily.HistoryQuery) (daily.HistoryPage, error)
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

func (m *mockDailyManager) ListHistory(ctx context.Context, userID uuid.UUID, query daily.HistoryQuery) (daily.HistoryPage, error) {
	if m.listHistory != nil {
		return m.listHistory(ctx, userID, query)
	}
	return daily.HistoryPage{}, errors.New("unexpected ListHistory call")
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
			body: `{"title":"Explore Mars","description":"scan surface","difficulty":"MEDIUM","due_date":"2026-09-15T10:00:00Z","time_zone":"UTC"}`,
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
					if input.Difficulty != daily.DifficultyMedium {
						t.Errorf("difficulty = %q, want MEDIUM", input.Difficulty)
					}
					if !input.DueDate.Equal(dueDate) {
						t.Errorf("due_date = %v, want %v", input.DueDate, dueDate)
					}
					if input.TimeZone != "UTC" {
						t.Errorf("time_zone = %q, want UTC", input.TimeZone)
					}
					return daily.Daily{
						ID:          dailyID,
						UserID:      userID,
						Title:       "Explore Mars",
						Description: "scan surface",
						Difficulty:  daily.DifficultyMedium,
						DueDate:     dueDate,
						TimeZone:    "UTC",
						Status:      daily.StatusPending,
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
			body:           `{"description":"scan surface","difficulty":"MEDIUM","due_date":"2026-09-15T10:00:00Z","time_zone":"UTC"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"title": "title is required"},
		},
		{
			name:           "invalid difficulty",
			body:           `{"title":"Explore Mars","difficulty":"EXTREME","due_date":"2026-09-15T10:00:00Z","time_zone":"UTC"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"difficulty": "must be one of: EASY, MEDIUM, HARD"},
		},
		{
			name:           "invalid due_date format",
			body:           `{"title":"Explore Mars","difficulty":"MEDIUM","due_date":"not-a-date","time_zone":"UTC"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"due_date": "must be a valid RFC3339 timestamp"},
		},
		{
			name: "creates daily from a local deadline resolved in the zone",
			body: `{"title":"Explore Mars","description":"scan surface","difficulty":"MEDIUM","due_local_date":"2026-03-08","due_local_time":"02:30","time_zone":"America/New_York"}`,
			setupManager: func(m *mockDailyManager) {
				m.create = func(ctx context.Context, input daily.CreateInput) (daily.Daily, error) {
					want := time.Date(2026, 3, 8, 7, 0, 0, 0, time.UTC)
					if !input.DueDate.Equal(want) {
						t.Errorf("due_date = %v, want %v (spring-forward gap resolved to first valid instant)", input.DueDate, want)
					}
					if input.TimeZone != "America/New_York" {
						t.Errorf("time_zone = %q, want America/New_York", input.TimeZone)
					}
					return daily.Daily{
						ID:          dailyID,
						UserID:      userID,
						Title:       "Explore Mars",
						Description: "scan surface",
						Difficulty:  daily.DifficultyMedium,
						DueDate:     want,
						TimeZone:    "America/New_York",
						Status:      daily.StatusPending,
						CreatedAt:   createdAt,
						UpdatedAt:   createdAt,
					}, nil
				}
			},
			wantStatus: http.StatusCreated,
			assertResponse: func(t *testing.T, resp dailyResponse) {
				if resp.DueDate != "2026-03-08T07:00:00Z" {
					t.Errorf("due_date = %q, want 2026-03-08T07:00:00Z", resp.DueDate)
				}
				if resp.DueLocalDate != "2026-03-08" {
					t.Errorf("due_local_date = %q, want 2026-03-08", resp.DueLocalDate)
				}
				if resp.DueLocalTime != "03:00" {
					t.Errorf("due_local_time = %q, want 03:00", resp.DueLocalTime)
				}
				if resp.TimeZone != "America/New_York" {
					t.Errorf("time_zone = %q, want America/New_York", resp.TimeZone)
				}
			},
		},
		{
			name:           "rejects due_date supplied with a local deadline",
			body:           `{"title":"Explore Mars","difficulty":"MEDIUM","due_date":"2026-09-15T10:00:00Z","due_local_date":"2026-09-15","due_local_time":"09:00","time_zone":"UTC"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"due_date": "must not be supplied with due_local_date or due_local_time"},
		},
		{
			name:           "rejects a local deadline without its time",
			body:           `{"title":"Explore Mars","difficulty":"MEDIUM","due_local_date":"2026-09-15","time_zone":"UTC"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"due_local_time": "is required with due_local_date"},
		},
		{
			name:           "rejects Go Local as a time zone",
			body:           `{"title":"Explore Mars","difficulty":"MEDIUM","due_local_date":"2026-09-15","due_local_time":"09:00","time_zone":"Local"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"time_zone": "must be a valid IANA time zone"},
		},
		{
			name:           "invalid time zone",
			body:           `{"title":"Explore Mars","difficulty":"MEDIUM","due_date":"2026-09-15T10:00:00Z","time_zone":"Mars/Olympus"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"time_zone": "must be a valid IANA time zone"},
		},
		{
			name:           "malformed JSON body",
			body:           `not valid json`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"body": "invalid JSON body"},
		},
		{
			name: "manager invalid difficulty error",
			body: `{"title":"Explore Mars","difficulty":"MEDIUM","due_date":"2026-09-15T10:00:00Z","time_zone":"UTC"}`,
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
			body: `{"title":"Explore Mars","difficulty":"MEDIUM","due_date":"2026-09-15T10:00:00Z","time_zone":"UTC"}`,
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
					if filter.From != nil || filter.To != nil {
						t.Errorf("range filter = %+v, want nil", filter)
					}
					return []daily.Daily{
						{
							ID:         dailyID,
							UserID:     userID,
							Title:      "Explore Mars",
							Difficulty: daily.DifficultyEasy,
							DueDate:    dueDate,
							Status:     daily.StatusPending,
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
			name: "filters by status and instant range",
			path: "/dailies?status=PENDING&from=2026-09-15T00:00:00Z&to=2026-09-16T00:00:00Z",
			setupManager: func(m *mockDailyManager) {
				m.list = func(ctx context.Context, id uuid.UUID, filter daily.ListFilter) ([]daily.Daily, error) {
					if id != userID {
						t.Errorf("user_id = %v, want %v", id, userID)
					}
					if filter.Status == nil || *filter.Status != daily.StatusPending {
						t.Errorf("status filter = %v, want PENDING", filter.Status)
					}
					wantFrom := time.Date(2026, 9, 15, 0, 0, 0, 0, time.UTC)
					wantTo := wantFrom.AddDate(0, 0, 1)
					if filter.From == nil || !filter.From.Equal(wantFrom) || filter.To == nil || !filter.To.Equal(wantTo) {
						t.Errorf("range = %+v, want [%v, %v)", filter, wantFrom, wantTo)
					}
					return []daily.Daily{
						{
							ID:         dailyID,
							UserID:     userID,
							Title:      "Explore Mars",
							Difficulty: daily.DifficultyEasy,
							DueDate:    dueDate,
							Status:     daily.StatusPending,
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
			name:           "invalid status filter returns 422",
			path:           "/dailies?status=INVALID_STATUS",
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"status": "must be one of: PENDING, COMPLETED, MISSED"},
		},
		{
			name: "legacy date filter maps to its UTC calendar-day range",
			path: "/dailies?date=2026-09-15",
			setupManager: func(m *mockDailyManager) {
				m.list = func(ctx context.Context, id uuid.UUID, filter daily.ListFilter) ([]daily.Daily, error) {
					wantFrom := time.Date(2026, 9, 15, 0, 0, 0, 0, time.UTC)
					wantTo := wantFrom.AddDate(0, 0, 1)
					if filter.From == nil || !filter.From.Equal(wantFrom) || filter.To == nil || !filter.To.Equal(wantTo) {
						t.Errorf("range = %+v, want [%v, %v)", filter, wantFrom, wantTo)
					}
					return []daily.Daily{}, nil
				}
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "legacy due_date alias accepts an RFC3339 instant",
			path: "/dailies?due_date=2026-09-15T10:00:00Z",
			setupManager: func(m *mockDailyManager) {
				m.list = func(ctx context.Context, id uuid.UUID, filter daily.ListFilter) ([]daily.Daily, error) {
					wantFrom := time.Date(2026, 9, 15, 0, 0, 0, 0, time.UTC)
					wantTo := wantFrom.AddDate(0, 0, 1)
					if filter.From == nil || !filter.From.Equal(wantFrom) || filter.To == nil || !filter.To.Equal(wantTo) {
						t.Errorf("range = %+v, want [%v, %v)", filter, wantFrom, wantTo)
					}
					return []daily.Daily{}, nil
				}
			},
			wantStatus: http.StatusOK,
		},
		{
			name:           "invalid legacy date filter returns 422",
			path:           "/dailies?date=not-a-day",
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"date": "date must be YYYY-MM-DD or RFC3339"},
		},
		{
			name:           "invalid from filter returns 422",
			path:           "/dailies?from=not-a-date",
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"from": "must be a valid RFC3339 timestamp"},
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
						Difficulty: daily.DifficultyHard,
						DueDate:    dueDate,
						Status:     daily.StatusPending,
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
						ID:         dailyID,
						UserID:     userID,
						Title:      "Colonize Mars",
						Difficulty: daily.DifficultyMedium,
						DueDate:    dueDate,
						Status:     daily.StatusPending,
						CreatedAt:  createdAt,
						UpdatedAt:  updatedAt,
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
			body:    `{"due_date":"2026-09-20T10:00:00Z","time_zone":"UTC"}`,
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
						ID:         dailyID,
						UserID:     userID,
						Title:      "Explore Mars",
						Difficulty: daily.DifficultyMedium,
						DueDate:    newDueDate,
						Status:     daily.StatusPending,
						CreatedAt:  createdAt,
						UpdatedAt:  updatedAt,
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
			name:    "updates due date from a local deadline resolved in the zone",
			dailyID: dailyID.String(),
			body:    `{"due_local_date":"2026-11-01","due_local_time":"01:30","time_zone":"America/New_York"}`,
			setupManager: func(m *mockDailyManager) {
				m.update = func(ctx context.Context, uID, dID uuid.UUID, input daily.UpdateInput) (daily.Daily, error) {
					want := time.Date(2026, 11, 1, 5, 30, 0, 0, time.UTC)
					if input.DueDate == nil || !input.DueDate.Equal(want) {
						t.Errorf("due_date = %v, want %v (first fall-back occurrence)", input.DueDate, want)
					}
					if input.TimeZone == nil || *input.TimeZone != "America/New_York" {
						t.Errorf("time_zone = %v, want America/New_York", input.TimeZone)
					}
					return daily.Daily{
						ID:         dailyID,
						UserID:     userID,
						Title:      "Explore Mars",
						Difficulty: daily.DifficultyMedium,
						DueDate:    want,
						TimeZone:   "America/New_York",
						Status:     daily.StatusPending,
						CreatedAt:  createdAt,
						UpdatedAt:  updatedAt,
					}, nil
				}
			},
			wantStatus: http.StatusOK,
			assertResponse: func(t *testing.T, resp dailyResponse) {
				if resp.DueDate != "2026-11-01T05:30:00Z" {
					t.Errorf("due_date = %q, want 2026-11-01T05:30:00Z", resp.DueDate)
				}
				if resp.DueLocalDate != "2026-11-01" || resp.DueLocalTime != "01:30" {
					t.Errorf("local deadline = %s %s, want 2026-11-01 01:30", resp.DueLocalDate, resp.DueLocalTime)
				}
			},
		},
		{
			name:           "rejects a local deadline without an explicit zone",
			dailyID:        dailyID.String(),
			body:           `{"due_local_date":"2026-11-01","due_local_time":"01:30"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"time_zone": "is required with a local deadline"},
		},
		{
			name:           "rejects due_date supplied with a local deadline",
			dailyID:        dailyID.String(),
			body:           `{"due_date":"2026-11-01T05:30:00Z","due_local_date":"2026-11-01","due_local_time":"01:30","time_zone":"America/New_York"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"due_date": "must not be supplied with due_local_date or due_local_time"},
		},
		{
			name:    "manager invalid time zone error",
			dailyID: dailyID.String(),
			body:    `{"time_zone":"Local"}`,
			setupManager: func(m *mockDailyManager) {
				m.update = func(ctx context.Context, uID, dID uuid.UUID, input daily.UpdateInput) (daily.Daily, error) {
					return daily.Daily{}, daily.ErrInvalidTimeZone
				}
			},
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"time_zone": "must be a valid IANA time zone"},
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
			name:    "updates completed daily",
			dailyID: dailyID.String(),
			body:    `{"title":"Colonize Mars"}`,
			setupManager: func(m *mockDailyManager) {
				m.update = func(ctx context.Context, uID, dID uuid.UUID, input daily.UpdateInput) (daily.Daily, error) {
					return daily.Daily{
						ID:         dailyID,
						UserID:     userID,
						Title:      "Colonize Mars",
						Difficulty: daily.DifficultyMedium,
						DueDate:    dueDate,
						Status:     daily.StatusCompleted,
						CreatedAt:  createdAt,
						UpdatedAt:  updatedAt,
					}, nil
				}
			},
			wantStatus: http.StatusOK,
			assertResponse: func(t *testing.T, resp dailyResponse) {
				if resp.Status != string(daily.StatusCompleted) {
					t.Errorf("status = %q, want COMPLETED", resp.Status)
				}
			},
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
			name:    "deletes completed daily",
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
						Difficulty: daily.DifficultyHard,
						Status:     daily.StatusCompleted,
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

type testDailyHistoryResponse struct {
	ID           string  `json:"id"`
	DailyID      string  `json:"daily_id"`
	UserID       string  `json:"user_id"`
	Title        string  `json:"title"`
	Description  string  `json:"description"`
	Difficulty   string  `json:"difficulty"`
	DueDate      string  `json:"due_date"`
	TimeZone     string  `json:"time_zone"`
	DueLocalDate string  `json:"due_local_date"`
	DueLocalTime string  `json:"due_local_time"`
	Status       string  `json:"status"`
	CompletedAt  *string `json:"completed_at"`
	MissedAt     *string `json:"missed_at"`
	ArchivedAt   string  `json:"archived_at"`
}

type testDailyHistoryPageResponse struct {
	Items      []testDailyHistoryResponse `json:"items"`
	NextCursor *string                    `json:"next_cursor"`
}

func TestListDailyHistory(t *testing.T) {
	userID := uuid.New()
	dailyID := uuid.New()
	historyID := uuid.New()
	dueDate := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	completedAt := time.Date(2026, 9, 15, 11, 0, 0, 0, time.UTC)
	archivedAt := time.Date(2026, 9, 15, 11, 0, 1, 0, time.UTC)

	completedItem := daily.DailyHistory{
		ID:          historyID,
		DailyID:     dailyID,
		UserID:      userID,
		Title:       "Meditate",
		Description: "15 min",
		Difficulty:  daily.DifficultyMedium,
		DueDate:     dueDate,
		TimeZone:    "America/New_York",
		Status:      daily.StatusCompleted,
		CompletedAt: &completedAt,
		MissedAt:    nil,
		ArchivedAt:  archivedAt,
	}

	tests := []struct {
		name           string
		path           string
		setupManager   func(m *mockDailyManager)
		wantStatus     int
		wantErrorCode  string
		wantFieldError map[string]string
		assertResponse func(t *testing.T, resp testDailyHistoryPageResponse)
	}{
		{
			name: "returns a history page for user",
			path: "/dailies/history",
			setupManager: func(m *mockDailyManager) {
				m.listHistory = func(ctx context.Context, uID uuid.UUID, query daily.HistoryQuery) (daily.HistoryPage, error) {
					if uID != userID {
						t.Errorf("user_id = %v, want %v", uID, userID)
					}
					if query.Limit != 0 || query.Cursor != "" {
						t.Errorf("query = %+v, want the unset first-page query", query)
					}
					return daily.HistoryPage{Items: []daily.DailyHistory{completedItem}}, nil
				}
			},
			wantStatus: http.StatusOK,
			assertResponse: func(t *testing.T, resp testDailyHistoryPageResponse) {
				if len(resp.Items) != 1 {
					t.Fatalf("len(items) = %d, want 1", len(resp.Items))
				}
				if resp.NextCursor != nil {
					t.Errorf("next_cursor = %v, want null on the final page", resp.NextCursor)
				}
				item := resp.Items[0]
				if item.ID != historyID.String() {
					t.Errorf("id = %q, want %q", item.ID, historyID.String())
				}
				if item.DailyID != dailyID.String() {
					t.Errorf("daily_id = %q, want %q", item.DailyID, dailyID.String())
				}
				if item.UserID != userID.String() {
					t.Errorf("user_id = %q, want %q", item.UserID, userID.String())
				}
				if item.Title != "Meditate" {
					t.Errorf("title = %q, want Meditate", item.Title)
				}
				if item.Difficulty != "MEDIUM" {
					t.Errorf("difficulty = %q, want MEDIUM", item.Difficulty)
				}
				if item.TimeZone != "America/New_York" {
					t.Errorf("time_zone = %q, want America/New_York", item.TimeZone)
				}
				if item.DueLocalDate != "2026-09-15" || item.DueLocalTime != "06:00" {
					t.Errorf("local deadline = %s %s, want 2026-09-15 06:00", item.DueLocalDate, item.DueLocalTime)
				}
				if item.Status != "COMPLETED" {
					t.Errorf("status = %q, want COMPLETED", item.Status)
				}
				wantCompleted := completedAt.Format(time.RFC3339)
				if item.CompletedAt == nil || *item.CompletedAt != wantCompleted {
					t.Errorf("completed_at = %v, want %q", item.CompletedAt, wantCompleted)
				}
				if item.MissedAt != nil {
					t.Errorf("missed_at = %v, want nil", item.MissedAt)
				}
				wantArchived := archivedAt.Format(time.RFC3339)
				if item.ArchivedAt != wantArchived {
					t.Errorf("archived_at = %q, want %q", item.ArchivedAt, wantArchived)
				}
			},
		},
		{
			name: "passes the bounded limit and opaque cursor to the manager",
			path: "/dailies/history?limit=5&cursor=opaque-token",
			setupManager: func(m *mockDailyManager) {
				m.listHistory = func(ctx context.Context, uID uuid.UUID, query daily.HistoryQuery) (daily.HistoryPage, error) {
					if query.Limit != 5 {
						t.Errorf("limit = %d, want 5", query.Limit)
					}
					if query.Cursor != "opaque-token" {
						t.Errorf("cursor = %q, want opaque-token", query.Cursor)
					}
					return daily.HistoryPage{}, nil
				}
			},
			wantStatus: http.StatusOK,
			assertResponse: func(t *testing.T, resp testDailyHistoryPageResponse) {
				if len(resp.Items) != 0 {
					t.Errorf("len(items) = %d, want 0", len(resp.Items))
				}
			},
		},
		{
			name: "returns the next cursor supplied by the manager",
			path: "/dailies/history?limit=5",
			setupManager: func(m *mockDailyManager) {
				m.listHistory = func(ctx context.Context, uID uuid.UUID, query daily.HistoryQuery) (daily.HistoryPage, error) {
					return daily.HistoryPage{Items: []daily.DailyHistory{completedItem}, NextCursor: "next-token"}, nil
				}
			},
			wantStatus: http.StatusOK,
			assertResponse: func(t *testing.T, resp testDailyHistoryPageResponse) {
				if resp.NextCursor == nil || *resp.NextCursor != "next-token" {
					t.Errorf("next_cursor = %v, want next-token", resp.NextCursor)
				}
			},
		},
		{
			name: "returns an empty page with a null next cursor",
			path: "/dailies/history",
			setupManager: func(m *mockDailyManager) {
				m.listHistory = func(ctx context.Context, uID uuid.UUID, query daily.HistoryQuery) (daily.HistoryPage, error) {
					return daily.HistoryPage{Items: []daily.DailyHistory{}}, nil
				}
			},
			wantStatus: http.StatusOK,
			assertResponse: func(t *testing.T, resp testDailyHistoryPageResponse) {
				if len(resp.Items) != 0 {
					t.Errorf("len(items) = %d, want 0", len(resp.Items))
				}
				if resp.NextCursor != nil {
					t.Errorf("next_cursor = %v, want null", resp.NextCursor)
				}
			},
		},
		{
			name:           "rejects a non-positive limit",
			path:           "/dailies/history?limit=0",
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"limit": "must be a positive integer"},
		},
		{
			name:           "rejects a non-integer limit",
			path:           "/dailies/history?limit=abc",
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"limit": "must be a positive integer"},
		},
		{
			name: "maps an invalid cursor to a field-scoped validation error",
			path: "/dailies/history?cursor=tampered",
			setupManager: func(m *mockDailyManager) {
				m.listHistory = func(ctx context.Context, uID uuid.UUID, query daily.HistoryQuery) (daily.HistoryPage, error) {
					return daily.HistoryPage{}, daily.ErrInvalidHistoryCursor
				}
			},
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"cursor": "is invalid or expired"},
		},
		{
			name: "manager error returns 500",
			path: "/dailies/history",
			setupManager: func(m *mockDailyManager) {
				m.listHistory = func(ctx context.Context, uID uuid.UUID, query daily.HistoryQuery) (daily.HistoryPage, error) {
					if uID != userID {
						t.Errorf("user_id = %v, want %v", uID, userID)
					}
					return daily.HistoryPage{}, errors.New("database down")
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
			req := sharedhttptest.NewRequest(t, http.MethodGet, tt.path, "")
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
				var resp testDailyHistoryPageResponse
				sharedhttptest.DecodeBody(t, rec, &resp)
				tt.assertResponse(t, resp)
			}
		})
	}
}
