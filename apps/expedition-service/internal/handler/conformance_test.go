package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/expedition"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/httpcontract"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

func newExpeditionConformance(
	t *testing.T,
	manager expeditionManager,
	launcher expedition.Launcher,
) (*http.ServeMux, http.Handler, *expeditionTestTokenSigner) {
	t.Helper()
	signer := newExpeditionTestTokenSigner(t)
	authHandshake := sharedhttp.NewAuthHandshake(auth.NewStaticJWKSCache(signer.kid, signer.priv.Public()))
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	mux := http.NewServeMux()
	NewHealthHandler("expedition-service").RegisterHealthRoutes(mux)
	NewExpeditionReadHandler(manager, authHandshake, logger).RegisterExpeditionReadRoutes(mux)
	NewExpeditionLaunchHandler(launcher, authHandshake, logger).RegisterExpeditionLaunchRoutes(mux)
	return mux, sharedhttp.RequestIDMiddleware(mux), signer
}

func TestOpenAPIConformance(t *testing.T) {
	doc := httpcontract.LoadSpec(t, "expedition")
	registered := []httpcontract.Operation{
		{Method: http.MethodGet, Path: "/health"},
		{Method: http.MethodGet, Path: "/expeditions/current"},
		{Method: http.MethodGet, Path: "/expeditions"},
		{Method: http.MethodGet, Path: "/expeditions/{id}"},
		{Method: http.MethodPost, Path: "/expeditions/launch"},
	}

	baseLauncher := &launchManagerMock{launch: func(context.Context, uuid.UUID, expedition.LaunchInput) (expedition.Record, error) {
		return expedition.Record{}, errors.New("unexpected Launch call")
	}}
	mux, _, _ := newExpeditionConformance(t, &mockExpeditionManager{}, baseLauncher)
	httpcontract.AssertRoutePatterns(t, mux, registered)
	httpcontract.AssertRouteCoverage(t, doc, registered)

	userID := uuid.New()
	record := testExpeditionRecord(userID)
	resultID := uuid.New()
	withResult := record
	withResult.Result = &expedition.Result{
		ID: resultID, ExpeditionID: record.ID, Outcome: "SUCCESS",
		RewardSummary: json.RawMessage(`{"materials_reward":20}`),
		CreatedAt:     record.CreatedAt,
	}

	tests := []struct {
		name              string
		method            string
		target            string
		body              string
		noAuth            bool
		configureManager  func(*mockExpeditionManager)
		configureLauncher func(*launchManagerMock)
		wantStatus        int
		responseOnly      bool
	}{
		{name: "health", method: http.MethodGet, target: "/health", noAuth: true, wantStatus: http.StatusOK},
		{
			name: "current expedition", method: http.MethodGet, target: "/expeditions/current",
			configureManager: func(m *mockExpeditionManager) {
				m.current = func(context.Context, uuid.UUID) (expedition.Record, error) { return record, nil }
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "current not found", method: http.MethodGet, target: "/expeditions/current",
			configureManager: func(m *mockExpeditionManager) {
				m.current = func(context.Context, uuid.UUID) (expedition.Record, error) {
					return expedition.Record{}, expedition.ErrNotFound
				}
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name: "current internal error", method: http.MethodGet, target: "/expeditions/current",
			configureManager: func(m *mockExpeditionManager) {
				m.current = func(context.Context, uuid.UUID) (expedition.Record, error) {
					return expedition.Record{}, errors.New("db down")
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
		{name: "current missing auth", method: http.MethodGet, target: "/expeditions/current", noAuth: true, wantStatus: http.StatusUnauthorized},
		{
			name: "list expeditions", method: http.MethodGet, target: "/expeditions?limit=101&offset=3",
			configureManager: func(m *mockExpeditionManager) {
				m.list = func(context.Context, uuid.UUID, expedition.ListFilter) ([]expedition.Record, error) {
					return []expedition.Record{record}, nil
				}
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "list invalid offset", method: http.MethodGet, target: "/expeditions?offset=-1",
			wantStatus: http.StatusUnprocessableEntity, responseOnly: true,
		},
		{
			name: "list internal error", method: http.MethodGet, target: "/expeditions",
			configureManager: func(m *mockExpeditionManager) {
				m.list = func(context.Context, uuid.UUID, expedition.ListFilter) ([]expedition.Record, error) {
					return nil, errors.New("db down")
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
		{name: "list missing auth", method: http.MethodGet, target: "/expeditions", noAuth: true, wantStatus: http.StatusUnauthorized},
		{
			name: "get expedition with result", method: http.MethodGet, target: "/expeditions/" + record.ID.String(),
			configureManager: func(m *mockExpeditionManager) {
				m.get = func(context.Context, uuid.UUID, uuid.UUID) (expedition.Record, error) { return withResult, nil }
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "get not found", method: http.MethodGet, target: "/expeditions/" + record.ID.String(),
			configureManager: func(m *mockExpeditionManager) {
				m.get = func(context.Context, uuid.UUID, uuid.UUID) (expedition.Record, error) {
					return expedition.Record{}, expedition.ErrNotFound
				}
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name: "get invalid id", method: http.MethodGet, target: "/expeditions/not-a-uuid",
			wantStatus: http.StatusUnprocessableEntity, responseOnly: true,
		},
		{name: "get missing auth", method: http.MethodGet, target: "/expeditions/" + record.ID.String(), noAuth: true, wantStatus: http.StatusUnauthorized},
		{
			name: "launch expedition", method: http.MethodPost, target: "/expeditions/launch",
			body: `{"materials_invested":10}`,
			configureLauncher: func(l *launchManagerMock) {
				l.launch = func(context.Context, uuid.UUID, expedition.LaunchInput) (expedition.Record, error) {
					return record, nil
				}
			},
			wantStatus: http.StatusCreated,
		},
		{
			name: "launch malformed JSON", method: http.MethodPost, target: "/expeditions/launch",
			body: `{`, wantStatus: http.StatusBadRequest, responseOnly: true,
		},
		{
			name: "launch zero materials", method: http.MethodPost, target: "/expeditions/launch",
			body: `{"materials_invested":0}`, wantStatus: http.StatusUnprocessableEntity, responseOnly: true,
		},
		{
			name: "launch insufficient materials", method: http.MethodPost, target: "/expeditions/launch",
			body: `{"materials_invested":10}`,
			configureLauncher: func(l *launchManagerMock) {
				l.launch = func(context.Context, uuid.UUID, expedition.LaunchInput) (expedition.Record, error) {
					return expedition.Record{}, expedition.ErrInsufficientMaterials
				}
			},
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name: "launch already active", method: http.MethodPost, target: "/expeditions/launch",
			body: `{"materials_invested":10}`,
			configureLauncher: func(l *launchManagerMock) {
				l.launch = func(context.Context, uuid.UUID, expedition.LaunchInput) (expedition.Record, error) {
					return expedition.Record{}, expedition.ErrAlreadyActive
				}
			},
			wantStatus: http.StatusConflict,
		},
		{
			name: "launch cooldown", method: http.MethodPost, target: "/expeditions/launch",
			body: `{"materials_invested":10}`,
			configureLauncher: func(l *launchManagerMock) {
				l.launch = func(context.Context, uuid.UUID, expedition.LaunchInput) (expedition.Record, error) {
					return expedition.Record{}, expedition.ErrCooldown
				}
			},
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name: "launch internal error", method: http.MethodPost, target: "/expeditions/launch",
			body: `{"materials_invested":10}`,
			configureLauncher: func(l *launchManagerMock) {
				l.launch = func(context.Context, uuid.UUID, expedition.LaunchInput) (expedition.Record, error) {
					return expedition.Record{}, errors.New("db down")
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
		{name: "launch missing auth", method: http.MethodPost, target: "/expeditions/launch", body: `{"materials_invested":10}`, noAuth: true, wantStatus: http.StatusUnauthorized},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			manager := &mockExpeditionManager{}
			if tc.configureManager != nil {
				tc.configureManager(manager)
			}
			launcher := &launchManagerMock{launch: func(context.Context, uuid.UUID, expedition.LaunchInput) (expedition.Record, error) {
				return expedition.Record{}, errors.New("unexpected Launch call")
			}}
			if tc.configureLauncher != nil {
				tc.configureLauncher(launcher)
			}
			_, router, signer := newExpeditionConformance(t, manager, launcher)

			buildRequest := func() *http.Request {
				var body io.Reader
				if tc.body != "" {
					body = strings.NewReader(tc.body)
				}
				req := httptest.NewRequest(tc.method, tc.target, body)
				req.Header.Set("Content-Type", "application/json")
				if !tc.noAuth {
					req.Header.Set("Authorization", "Bearer "+signer.token(t, userID.String()))
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
