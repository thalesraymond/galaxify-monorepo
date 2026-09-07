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
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/ship"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
	sharedhttptest "github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp/test"
)

type mockShipManager struct {
	get    func(context.Context, uuid.UUID) (ship.State, error)
	repair func(context.Context, uuid.UUID) (ship.State, error)
}

func (m *mockShipManager) Get(ctx context.Context, userID uuid.UUID) (ship.State, error) {
	if m.get == nil {
		return ship.State{}, errors.New("unexpected Get call")
	}
	return m.get(ctx, userID)
}

func (m *mockShipManager) Repair(ctx context.Context, userID uuid.UUID) (ship.State, error) {
	if m.repair == nil {
		return ship.State{}, errors.New("unexpected Repair call")
	}
	return m.repair(ctx, userID)
}

type shipTestTokenSigner struct {
	kid  string
	priv ed25519.PrivateKey
}

func newShipTestTokenSigner(t *testing.T) *shipTestTokenSigner {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate signing key: %v", err)
	}
	return &shipTestTokenSigner{kid: "ship-test-kid", priv: priv}
}

func (s *shipTestTokenSigner) token(t *testing.T, userID string) string {
	t.Helper()
	token, err := auth.IssueAccessToken(s.priv, s.kid, userID, "")
	if err != nil {
		t.Fatalf("issue access token: %v", err)
	}
	return token
}

func newTestShipRouter(t *testing.T, manager ship.Manager) (http.Handler, *shipTestTokenSigner) {
	t.Helper()
	signer := newShipTestTokenSigner(t)
	authHandshake := sharedhttp.NewAuthHandshake(auth.NewStaticJWKSCache(signer.kid, signer.priv.Public()))
	shipHandler := NewShipHandler(manager, authHandshake, slog.New(slog.NewTextHandler(io.Discard, nil)))
	mux := http.NewServeMux()
	shipHandler.RegisterShipRoutes(mux)
	return mux, signer
}

func TestShipHandlerRepair(t *testing.T) {
	userID := uuid.New()
	updatedAt := time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)
	state := ship.State{UserID: userID, HullHealth: 96, MaterialsBalance: 0, Level: 2, UpdatedAt: updatedAt}

	tests := []struct {
		name          string
		body          string
		repairErr     error
		wantStatus    int
		wantErrorCode string
	}{
		{name: "repairs ship", wantStatus: http.StatusOK},
		{name: "accepts explicitly empty body", wantStatus: http.StatusOK},
		{name: "rejects non-empty body", body: `{}`, wantStatus: http.StatusUnprocessableEntity, wantErrorCode: "VALIDATION_FAILED"},
		{name: "returns ship not found", repairErr: ship.ErrNotFound, wantStatus: http.StatusNotFound, wantErrorCode: "SHIP_NOT_FOUND"},
		{name: "returns hull full", repairErr: ship.ErrHullFull, wantStatus: http.StatusUnprocessableEntity, wantErrorCode: "SHIP_HULL_FULL"},
		{name: "returns insufficient materials", repairErr: ship.ErrInsufficientMaterials, wantStatus: http.StatusUnprocessableEntity, wantErrorCode: "SHIP_INSUFFICIENT_MATERIALS"},
		{name: "returns internal error", repairErr: errors.New("database unavailable"), wantStatus: http.StatusInternalServerError, wantErrorCode: "INTERNAL_ERROR"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			manager := &mockShipManager{repair: func(_ context.Context, gotUserID uuid.UUID) (ship.State, error) {
				if gotUserID != userID {
					t.Errorf("repair user_id = %s, want %s", gotUserID, userID)
				}
				return state, test.repairErr
			}}
			router, signer := newTestShipRouter(t, manager)
			var body io.Reader
			if test.name == "accepts explicitly empty body" {
				body = strings.NewReader("")
			} else if test.body != "" {
				body = strings.NewReader(test.body)
			}
			req := httptest.NewRequest(http.MethodPost, "/ships/repair", body)
			req.Header.Set("Authorization", "Bearer "+signer.token(t, userID.String()))
			rec := httptest.NewRecorder()

			router.ServeHTTP(rec, req)

			sharedhttptest.WantStatus(t, rec, test.wantStatus)
			if test.wantErrorCode != "" {
				sharedhttptest.WantErrorCode(t, rec, test.wantErrorCode)
				return
			}
			var response shipResponse
			sharedhttptest.DecodeBody(t, rec, &response)
			if response.UserID != userID.String() || response.HullHealth != 96 || response.MaterialsBalance != 0 || response.Level != 2 || response.UpdatedAt != updatedAt.Format(time.RFC3339Nano) {
				t.Errorf("response = %+v, want updated ship state", response)
			}
		})
	}
}

func TestShipHandlerRepairRequiresAuthentication(t *testing.T) {
	router, _ := newTestShipRouter(t, &mockShipManager{})
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/ships/repair", nil))

	sharedhttptest.WantStatus(t, rec, http.StatusUnauthorized)
	sharedhttptest.WantErrorCode(t, rec, "AUTH_MISSING_HEADER")
}

func TestShipHandlerGetMe(t *testing.T) {
	userID := uuid.New()
	updatedAt := time.Date(2026, 9, 20, 12, 0, 0, 0, time.UTC)
	state := ship.State{
		UserID:           userID,
		HullHealth:       100,
		MaterialsBalance: 15,
		Level:            1,
		UpdatedAt:        updatedAt,
	}

	tests := []struct {
		name           string
		tokenUserID    string
		noAuthHeader   bool
		getErr         error
		wantStatus     int
		wantErrorCode  string
		wantCallUserID uuid.UUID
	}{
		{
			name:           "happy path: valid token and ship exists returns 200 with ship state",
			tokenUserID:    userID.String(),
			wantStatus:     http.StatusOK,
			wantCallUserID: userID,
		},
		{
			name:           "ship not found returns 404 SHIP_NOT_FOUND",
			tokenUserID:    userID.String(),
			getErr:         ship.ErrNotFound,
			wantStatus:     http.StatusNotFound,
			wantErrorCode:  "SHIP_NOT_FOUND",
			wantCallUserID: userID,
		},
		{
			name:           "invalid user id returns 422 VALIDATION_FAILED",
			tokenUserID:    "not-a-uuid",
			wantStatus:     http.StatusUnprocessableEntity,
			wantErrorCode:  "VALIDATION_FAILED",
			wantCallUserID: uuid.Nil,
		},
		{
			name:           "internal error returns 500 INTERNAL_ERROR",
			tokenUserID:    userID.String(),
			getErr:         errors.New("database unavailable"),
			wantStatus:     http.StatusInternalServerError,
			wantErrorCode:  "INTERNAL_ERROR",
			wantCallUserID: userID,
		},
		{
			name:           "missing auth header returns 401 AUTH_MISSING_HEADER",
			noAuthHeader:   true,
			wantStatus:     http.StatusUnauthorized,
			wantErrorCode:  "AUTH_MISSING_HEADER",
			wantCallUserID: uuid.Nil,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var calledUserID uuid.UUID
			manager := &mockShipManager{
				get: func(_ context.Context, gotUserID uuid.UUID) (ship.State, error) {
					calledUserID = gotUserID
					return state, test.getErr
				},
			}
			router, signer := newTestShipRouter(t, manager)
			req := httptest.NewRequest(http.MethodGet, "/ships/me", nil)
			if !test.noAuthHeader {
				req.Header.Set("Authorization", "Bearer "+signer.token(t, test.tokenUserID))
			}
			rec := httptest.NewRecorder()

			router.ServeHTTP(rec, req)

			sharedhttptest.WantStatus(t, rec, test.wantStatus)
			if test.wantErrorCode != "" {
				sharedhttptest.WantErrorCode(t, rec, test.wantErrorCode)
			}
			if calledUserID != test.wantCallUserID {
				t.Errorf("manager called with user_id = %s, want %s", calledUserID, test.wantCallUserID)
			}
			if test.wantErrorCode != "" {
				return
			}
			var response shipResponse
			sharedhttptest.DecodeBody(t, rec, &response)
			if response.UserID != userID.String() ||
				response.HullHealth != state.HullHealth ||
				response.MaterialsBalance != state.MaterialsBalance ||
				response.Level != state.Level ||
				response.UpdatedAt != updatedAt.Format(time.RFC3339Nano) {
				t.Errorf("response = %+v, want ship state %+v", response, state)
			}
		})
	}
}
