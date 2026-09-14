package handler

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/daily"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/httpcontract"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

func newDailyConformance(t *testing.T, manager dailyManager) (*http.ServeMux, http.Handler, *testTokenSigner) {
	t.Helper()
	signer := newTestTokenSigner()
	authHandshake := sharedhttp.NewAuthHandshake(auth.NewStaticJWKSCache(signer.kid, signer.priv.Public()))
	mux := http.NewServeMux()
	NewHealthHandler("daily-service").RegisterHealthRoutes(mux)
	NewDailyHandler(manager, authHandshake, slog.New(slog.NewTextHandler(io.Discard, nil))).RegisterDailyRoutes(mux)
	return mux, sharedhttp.RequestIDMiddleware(mux), signer
}

func TestOpenAPIConformance(t *testing.T) {
	doc := httpcontract.LoadSpec(t, "daily")
	registered := []httpcontract.Operation{
		{Method: http.MethodGet, Path: "/health"},
		{Method: http.MethodPost, Path: "/dailies"},
		{Method: http.MethodGet, Path: "/dailies"},
		{Method: http.MethodGet, Path: "/dailies/history"},
		{Method: http.MethodGet, Path: "/dailies/{id}"},
		{Method: http.MethodPatch, Path: "/dailies/{id}"},
		{Method: http.MethodDelete, Path: "/dailies/{id}"},
		{Method: http.MethodPost, Path: "/dailies/{id}/complete"},
	}

	mux, _, _ := newDailyConformance(t, &mockDailyManager{})
	httpcontract.AssertRoutePatterns(t, mux, registered)
	httpcontract.AssertRouteCoverage(t, doc, registered)

	userID := uuid.New()
	dailyID := uuid.New()
	dueDate := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	item := daily.Daily{
		ID: dailyID, UserID: userID, Title: "Explore Mars", Description: "scan surface",
		Difficulty: daily.DifficultyMedium, DueDate: dueDate, TimeZone: "UTC", Status: daily.StatusPending,
		CreatedAt: createdAt, UpdatedAt: createdAt,
	}
	historyID := uuid.New()
	completedAt := dueDate.Add(time.Hour)
	history := daily.DailyHistory{
		ID: historyID, DailyID: dailyID, UserID: userID, Title: "Explore Mars",
		Description: "scan surface", Difficulty: daily.DifficultyMedium, DueDate: dueDate, TimeZone: "UTC",
		Status: daily.StatusCompleted, CompletedAt: &completedAt, ArchivedAt: completedAt.Add(time.Second),
	}

	createBody := `{"title":"Explore Mars","description":"scan surface","difficulty":"MEDIUM","due_date":"2026-09-15T10:00:00Z","time_zone":"UTC"}`
	createLocalDeadlineBody := `{"title":"Explore Mars","description":"scan surface","difficulty":"MEDIUM","due_local_date":"2026-09-15","due_local_time":"09:00","time_zone":"America/New_York"}`

	tests := []struct {
		name         string
		method       string
		target       string
		body         string
		noAuth       bool
		configure    func(*mockDailyManager)
		wantStatus   int
		responseOnly bool
	}{
		{name: "health", method: http.MethodGet, target: "/health", noAuth: true, wantStatus: http.StatusOK},
		{
			name: "create daily", method: http.MethodPost, target: "/dailies", body: createBody,
			configure: func(m *mockDailyManager) {
				m.create = func(context.Context, daily.CreateInput) (daily.Daily, error) { return item, nil }
			},
			wantStatus: http.StatusCreated,
		},
		{
			name: "create daily from local deadline", method: http.MethodPost, target: "/dailies", body: createLocalDeadlineBody,
			configure: func(m *mockDailyManager) {
				m.create = func(context.Context, daily.CreateInput) (daily.Daily, error) { return item, nil }
			},
			wantStatus: http.StatusCreated,
		},
		{
			name: "create daily validation error", method: http.MethodPost, target: "/dailies",
			body:         `{"difficulty":"EXTREME","due_date":"2026-09-15T10:00:00Z","time_zone":"UTC"}`,
			wantStatus:   http.StatusUnprocessableEntity,
			responseOnly: true,
		},
		{
			name: "create daily internal error", method: http.MethodPost, target: "/dailies", body: createBody,
			configure: func(m *mockDailyManager) {
				m.create = func(context.Context, daily.CreateInput) (daily.Daily, error) {
					return daily.Daily{}, errors.New("db down")
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "list dailies", method: http.MethodGet, target: "/dailies?status=PENDING",
			configure: func(m *mockDailyManager) {
				m.list = func(context.Context, uuid.UUID, daily.ListFilter) ([]daily.Daily, error) {
					return []daily.Daily{item}, nil
				}
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "list dailies with instant range", method: http.MethodGet,
			target: "/dailies?from=2026-09-15T00:00:00Z&to=2026-09-16T00:00:00Z",
			configure: func(m *mockDailyManager) {
				m.list = func(context.Context, uuid.UUID, daily.ListFilter) ([]daily.Daily, error) {
					return []daily.Daily{item}, nil
				}
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "list dailies with legacy date", method: http.MethodGet, target: "/dailies?date=2026-09-15",
			configure: func(m *mockDailyManager) {
				m.list = func(context.Context, uuid.UUID, daily.ListFilter) ([]daily.Daily, error) {
					return []daily.Daily{item}, nil
				}
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "list dailies invalid status", method: http.MethodGet, target: "/dailies?status=NOPE",
			wantStatus: http.StatusUnprocessableEntity, responseOnly: true,
		},
		{
			name: "list dailies internal error", method: http.MethodGet, target: "/dailies",
			configure: func(m *mockDailyManager) {
				m.list = func(context.Context, uuid.UUID, daily.ListFilter) ([]daily.Daily, error) {
					return nil, errors.New("db down")
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
		{name: "list dailies missing auth", method: http.MethodGet, target: "/dailies", noAuth: true, wantStatus: http.StatusUnauthorized},
		{
			name: "history", method: http.MethodGet, target: "/dailies/history",
			configure: func(m *mockDailyManager) {
				m.listHistory = func(context.Context, uuid.UUID) ([]daily.DailyHistory, error) {
					return []daily.DailyHistory{history}, nil
				}
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "history internal error", method: http.MethodGet, target: "/dailies/history",
			configure: func(m *mockDailyManager) {
				m.listHistory = func(context.Context, uuid.UUID) ([]daily.DailyHistory, error) { return nil, errors.New("db down") }
			},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "get daily", method: http.MethodGet, target: "/dailies/" + dailyID.String(),
			configure: func(m *mockDailyManager) {
				m.get = func(context.Context, uuid.UUID, uuid.UUID) (daily.Daily, error) { return item, nil }
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "get daily not found", method: http.MethodGet, target: "/dailies/" + dailyID.String(),
			configure: func(m *mockDailyManager) {
				m.get = func(context.Context, uuid.UUID, uuid.UUID) (daily.Daily, error) {
					return daily.Daily{}, daily.ErrDailyNotFound
				}
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name: "get daily invalid id", method: http.MethodGet, target: "/dailies/not-a-uuid",
			wantStatus: http.StatusUnprocessableEntity, responseOnly: true,
		},
		{
			name: "get daily internal error", method: http.MethodGet, target: "/dailies/" + dailyID.String(),
			configure: func(m *mockDailyManager) {
				m.get = func(context.Context, uuid.UUID, uuid.UUID) (daily.Daily, error) {
					return daily.Daily{}, errors.New("db down")
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "update daily", method: http.MethodPatch, target: "/dailies/" + dailyID.String(),
			body: `{"title":"Colonize Mars"}`,
			configure: func(m *mockDailyManager) {
				m.update = func(context.Context, uuid.UUID, uuid.UUID, daily.UpdateInput) (daily.Daily, error) { return item, nil }
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "update daily conflict", method: http.MethodPatch, target: "/dailies/" + dailyID.String(),
			body: `{"title":"Colonize Mars"}`,
			configure: func(m *mockDailyManager) {
				m.update = func(context.Context, uuid.UUID, uuid.UUID, daily.UpdateInput) (daily.Daily, error) {
					return daily.Daily{}, daily.ErrDailyNotPending
				}
			},
			wantStatus: http.StatusConflict,
		},
		{
			name: "update daily invalid difficulty", method: http.MethodPatch, target: "/dailies/" + dailyID.String(),
			body:       `{"difficulty":"EXTREME"}`,
			wantStatus: http.StatusUnprocessableEntity, responseOnly: true,
		},
		{
			name: "update daily not found", method: http.MethodPatch, target: "/dailies/" + dailyID.String(),
			body: `{"title":"Colonize Mars"}`,
			configure: func(m *mockDailyManager) {
				m.update = func(context.Context, uuid.UUID, uuid.UUID, daily.UpdateInput) (daily.Daily, error) {
					return daily.Daily{}, daily.ErrDailyNotFound
				}
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name: "delete daily", method: http.MethodDelete, target: "/dailies/" + dailyID.String(),
			configure: func(m *mockDailyManager) {
				m.delete = func(context.Context, uuid.UUID, uuid.UUID) error { return nil }
			},
			wantStatus: http.StatusNoContent,
		},
		{
			name: "delete daily conflict", method: http.MethodDelete, target: "/dailies/" + dailyID.String(),
			configure: func(m *mockDailyManager) {
				m.delete = func(context.Context, uuid.UUID, uuid.UUID) error { return daily.ErrDailyNotPending }
			},
			wantStatus: http.StatusConflict,
		},
		{
			name: "delete daily not found", method: http.MethodDelete, target: "/dailies/" + dailyID.String(),
			configure: func(m *mockDailyManager) {
				m.delete = func(context.Context, uuid.UUID, uuid.UUID) error { return daily.ErrDailyNotFound }
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name: "complete daily", method: http.MethodPost, target: "/dailies/" + dailyID.String() + "/complete",
			configure: func(m *mockDailyManager) {
				m.complete = func(context.Context, uuid.UUID, uuid.UUID) (daily.Daily, error) { return item, nil }
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "complete daily conflict", method: http.MethodPost, target: "/dailies/" + dailyID.String() + "/complete",
			configure: func(m *mockDailyManager) {
				m.complete = func(context.Context, uuid.UUID, uuid.UUID) (daily.Daily, error) {
					return daily.Daily{}, daily.ErrDailyAlreadyCompleted
				}
			},
			wantStatus: http.StatusConflict,
		},
		{
			name: "complete daily not found", method: http.MethodPost, target: "/dailies/" + dailyID.String() + "/complete",
			configure: func(m *mockDailyManager) {
				m.complete = func(context.Context, uuid.UUID, uuid.UUID) (daily.Daily, error) {
					return daily.Daily{}, daily.ErrDailyNotFound
				}
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name: "complete daily internal error", method: http.MethodPost, target: "/dailies/" + dailyID.String() + "/complete",
			configure: func(m *mockDailyManager) {
				m.complete = func(context.Context, uuid.UUID, uuid.UUID) (daily.Daily, error) {
					return daily.Daily{}, errors.New("db down")
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "complete daily missing auth", method: http.MethodPost, target: "/dailies/" + dailyID.String() + "/complete",
			noAuth: true, wantStatus: http.StatusUnauthorized,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			manager := &mockDailyManager{}
			if tc.configure != nil {
				tc.configure(manager)
			}
			_, router, signer := newDailyConformance(t, manager)

			buildRequest := func() *http.Request {
				var body io.Reader
				if tc.body != "" {
					body = strings.NewReader(tc.body)
				}
				req := httptest.NewRequest(tc.method, tc.target, body)
				req.Header.Set("Content-Type", "application/json")
				if !tc.noAuth {
					req.Header.Set("Authorization", "Bearer "+signer.Token(userID.String()))
				}
				return req
			}

			httpcontract.RunExchange(t, doc, router, buildRequest, httpcontract.ExchangeOptions{
				ValidateRequest: !tc.responseOnly,
				WantStatus:      tc.wantStatus,
			})
		})
	}
}
