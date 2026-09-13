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

	"github.com/google/uuid"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/ship"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/httpcontract"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

func newShipConformance(t *testing.T, manager ship.Manager) (*http.ServeMux, http.Handler, *shipTestTokenSigner) {
	t.Helper()
	signer := newShipTestTokenSigner(t)
	authHandshake := sharedhttp.NewAuthHandshake(auth.NewStaticJWKSCache(signer.kid, signer.priv.Public()))
	mux := http.NewServeMux()
	NewHealthHandler("ship-service").RegisterHealthRoutes(mux)
	NewShipHandler(manager, authHandshake, slog.New(slog.NewTextHandler(io.Discard, nil))).RegisterShipRoutes(mux)
	return mux, sharedhttp.RequestIDMiddleware(mux), signer
}

func TestOpenAPIConformance(t *testing.T) {
	doc := httpcontract.LoadSpec(t, "ship")
	registered := []httpcontract.Operation{
		{Method: http.MethodGet, Path: "/health"},
		{Method: http.MethodGet, Path: "/ships/me"},
		{Method: http.MethodPost, Path: "/ships/repair"},
	}

	mux, _, _ := newShipConformance(t, &mockShipManager{})
	httpcontract.AssertRoutePatterns(t, mux, registered)
	httpcontract.AssertRouteCoverage(t, doc, registered)

	userID := uuid.New()
	state := ship.State{UserID: userID, HullHealth: 96, MaterialsBalance: 3, Level: 2}

	happyGet := func(m *mockShipManager) {
		m.get = func(context.Context, uuid.UUID) (ship.State, error) { return state, nil }
	}
	happyRepair := func(m *mockShipManager) {
		m.repair = func(context.Context, uuid.UUID) (ship.State, error) { return state, nil }
	}

	tests := []struct {
		name         string
		method       string
		target       string
		body         string
		noAuth       bool
		tokenSubject string
		configure    func(*mockShipManager)
		wantStatus   int
	}{
		{name: "health", method: http.MethodGet, target: "/health", noAuth: true, wantStatus: http.StatusOK},
		{name: "get me", method: http.MethodGet, target: "/ships/me", configure: happyGet, wantStatus: http.StatusOK},
		{
			name: "get me not provisioned", method: http.MethodGet, target: "/ships/me",
			configure: func(m *mockShipManager) {
				m.get = func(context.Context, uuid.UUID) (ship.State, error) { return ship.State{}, ship.ErrNotFound }
			},
			wantStatus: http.StatusNotFound,
		},
		{name: "get me invalid subject", method: http.MethodGet, target: "/ships/me", tokenSubject: "not-a-uuid", wantStatus: http.StatusUnprocessableEntity},
		{
			name: "get me internal error", method: http.MethodGet, target: "/ships/me",
			configure: func(m *mockShipManager) {
				m.get = func(context.Context, uuid.UUID) (ship.State, error) { return ship.State{}, errors.New("database down") }
			},
			wantStatus: http.StatusInternalServerError,
		},
		{name: "get me missing auth", method: http.MethodGet, target: "/ships/me", noAuth: true, wantStatus: http.StatusUnauthorized},
		{name: "repair", method: http.MethodPost, target: "/ships/repair", configure: happyRepair, wantStatus: http.StatusOK},
		{
			name: "repair rejects non-empty body", method: http.MethodPost, target: "/ships/repair", body: `{}`,
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name: "repair hull full", method: http.MethodPost, target: "/ships/repair",
			configure: func(m *mockShipManager) {
				m.repair = func(context.Context, uuid.UUID) (ship.State, error) { return ship.State{}, ship.ErrHullFull }
			},
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name: "repair insufficient materials", method: http.MethodPost, target: "/ships/repair",
			configure: func(m *mockShipManager) {
				m.repair = func(context.Context, uuid.UUID) (ship.State, error) {
					return ship.State{}, ship.ErrInsufficientMaterials
				}
			},
			wantStatus: http.StatusUnprocessableEntity,
		},
		{
			name: "repair not provisioned", method: http.MethodPost, target: "/ships/repair",
			configure: func(m *mockShipManager) {
				m.repair = func(context.Context, uuid.UUID) (ship.State, error) { return ship.State{}, ship.ErrNotFound }
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name: "repair internal error", method: http.MethodPost, target: "/ships/repair",
			configure: func(m *mockShipManager) {
				m.repair = func(context.Context, uuid.UUID) (ship.State, error) { return ship.State{}, errors.New("database down") }
			},
			wantStatus: http.StatusInternalServerError,
		},
		{name: "repair missing auth", method: http.MethodPost, target: "/ships/repair", noAuth: true, wantStatus: http.StatusUnauthorized},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			manager := &mockShipManager{}
			if tc.configure != nil {
				tc.configure(manager)
			}
			_, router, signer := newShipConformance(t, manager)

			buildRequest := func() *http.Request {
				var body io.Reader
				if tc.body != "" {
					body = strings.NewReader(tc.body)
				}
				req := httptest.NewRequest(tc.method, tc.target, body)
				req.Header.Set("Content-Type", "application/json")
				if !tc.noAuth {
					subject := tc.tokenSubject
					if subject == "" {
						subject = userID.String()
					}
					req.Header.Set("Authorization", "Bearer "+signer.token(t, subject))
				}
				return req
			}

			httpcontract.RunExchange(t, doc, router, buildRequest, httpcontract.ExchangeOptions{
				ValidateRequest: true,
				WantStatus:      tc.wantStatus,
			})
		})
	}
}
