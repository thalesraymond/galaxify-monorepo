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

	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/expedition"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
	sharedhttptest "github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp/test"
)

type mockExpeditionManager struct {
	current func(context.Context, uuid.UUID) (expedition.Record, error)
	get     func(context.Context, uuid.UUID, uuid.UUID) (expedition.Record, error)
	list    func(context.Context, uuid.UUID, expedition.ListFilter) ([]expedition.Record, error)
}

func (m *mockExpeditionManager) Current(ctx context.Context, userID uuid.UUID) (expedition.Record, error) {
	if m.current == nil {
		return expedition.Record{}, errors.New("unexpected Current call")
	}
	return m.current(ctx, userID)
}

func (m *mockExpeditionManager) Get(ctx context.Context, userID, expeditionID uuid.UUID) (expedition.Record, error) {
	if m.get == nil {
		return expedition.Record{}, errors.New("unexpected Get call")
	}
	return m.get(ctx, userID, expeditionID)
}

func (m *mockExpeditionManager) List(ctx context.Context, userID uuid.UUID, filter expedition.ListFilter) ([]expedition.Record, error) {
	if m.list == nil {
		return nil, errors.New("unexpected List call")
	}
	return m.list(ctx, userID, filter)
}

type expeditionTestTokenSigner struct {
	kid  string
	priv ed25519.PrivateKey
}

func newExpeditionTestTokenSigner(t *testing.T) *expeditionTestTokenSigner {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate signing key: %v", err)
	}
	return &expeditionTestTokenSigner{kid: "expedition-test-kid", priv: priv}
}

func (s *expeditionTestTokenSigner) token(t *testing.T, userID string) string {
	t.Helper()
	token, err := auth.IssueAccessToken(s.priv, s.kid, userID, "")
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return token
}

func newTestExpeditionReadRouter(t *testing.T, manager expeditionManager) (http.Handler, *expeditionTestTokenSigner) {
	t.Helper()
	signer := newExpeditionTestTokenSigner(t)
	readHandler := NewExpeditionReadHandler(
		manager,
		sharedhttp.NewAuthHandshake(auth.NewStaticJWKSCache(signer.kid, signer.priv.Public())),
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	mux := http.NewServeMux()
	readHandler.RegisterExpeditionReadRoutes(mux)
	return mux, signer
}

func TestExpeditionReadHandlerCurrent(t *testing.T) {
	userID := uuid.New()
	record := testExpeditionRecord(userID)

	tests := []struct {
		name          string
		currentErr    error
		noAuthHeader  bool
		wantStatus    int
		wantErrorCode string
	}{
		{name: "returns active expedition", wantStatus: http.StatusOK},
		{name: "returns not found", currentErr: expedition.ErrNotFound, wantStatus: http.StatusNotFound, wantErrorCode: expeditionNotFoundCode},
		{name: "returns internal error", currentErr: errors.New("database unavailable"), wantStatus: http.StatusInternalServerError, wantErrorCode: "INTERNAL_ERROR"},
		{name: "requires authentication", noAuthHeader: true, wantStatus: http.StatusUnauthorized, wantErrorCode: "AUTH_MISSING_HEADER"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			called := false
			router, signer := newTestExpeditionReadRouter(t, &mockExpeditionManager{current: func(_ context.Context, gotUserID uuid.UUID) (expedition.Record, error) {
				called = true
				if gotUserID != userID {
					t.Errorf("Current user_id = %s, want %s", gotUserID, userID)
				}
				return record, test.currentErr
			}})
			req := httptest.NewRequest(http.MethodGet, "/expeditions/current", nil)
			if !test.noAuthHeader {
				req.Header.Set("Authorization", "Bearer "+signer.token(t, userID.String()))
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			sharedhttptest.WantStatus(t, rec, test.wantStatus)
			if test.wantErrorCode != "" {
				sharedhttptest.WantErrorCode(t, rec, test.wantErrorCode)
				if test.noAuthHeader && called {
					t.Error("manager was called without authentication")
				}
				return
			}
			var response expeditionResponse
			sharedhttptest.DecodeBody(t, rec, &response)
			assertExpeditionResponse(t, response, record)
		})
	}
}

func TestExpeditionReadHandlerGet(t *testing.T) {
	userID, expeditionID := uuid.New(), uuid.New()
	record := testExpeditionRecord(userID)
	record.ID = expeditionID
	resultID := uuid.New()
	record.Result = &expedition.Result{ID: resultID, ExpeditionID: expeditionID, Outcome: "SUCCESS", RewardSummary: []byte(`{"materials_reward":20}`), CreatedAt: record.CreatedAt}

	tests := []struct {
		name          string
		path          string
		getErr        error
		noAuthHeader  bool
		wantStatus    int
		wantErrorCode string
	}{
		{name: "returns expedition with result", path: "/expeditions/" + expeditionID.String(), wantStatus: http.StatusOK},
		{name: "returns not found", path: "/expeditions/" + expeditionID.String(), getErr: expedition.ErrNotFound, wantStatus: http.StatusNotFound, wantErrorCode: expeditionNotFoundCode},
		{name: "returns internal error", path: "/expeditions/" + expeditionID.String(), getErr: errors.New("database unavailable"), wantStatus: http.StatusInternalServerError, wantErrorCode: "INTERNAL_ERROR"},
		{name: "rejects invalid id", path: "/expeditions/not-a-uuid", wantStatus: http.StatusUnprocessableEntity, wantErrorCode: "VALIDATION_FAILED"},
		{name: "requires authentication", path: "/expeditions/" + expeditionID.String(), noAuthHeader: true, wantStatus: http.StatusUnauthorized, wantErrorCode: "AUTH_MISSING_HEADER"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			called := false
			router, signer := newTestExpeditionReadRouter(t, &mockExpeditionManager{get: func(_ context.Context, gotUserID, gotExpeditionID uuid.UUID) (expedition.Record, error) {
				called = true
				if gotUserID != userID || gotExpeditionID != expeditionID {
					t.Errorf("Get ids = %s, %s, want %s, %s", gotUserID, gotExpeditionID, userID, expeditionID)
				}
				return record, test.getErr
			}})
			req := httptest.NewRequest(http.MethodGet, test.path, nil)
			if !test.noAuthHeader {
				req.Header.Set("Authorization", "Bearer "+signer.token(t, userID.String()))
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			sharedhttptest.WantStatus(t, rec, test.wantStatus)
			if test.wantErrorCode != "" {
				sharedhttptest.WantErrorCode(t, rec, test.wantErrorCode)
				if (test.path == "/expeditions/not-a-uuid" || test.noAuthHeader) && called {
					t.Error("manager was called for an invalid or unauthenticated request")
				}
				return
			}
			var response expeditionResponse
			sharedhttptest.DecodeBody(t, rec, &response)
			assertExpeditionResponse(t, response, record)
			if response.Result == nil || response.Result.Outcome != "SUCCESS" {
				t.Errorf("result = %+v, want success result", response.Result)
			}
		})
	}
}

func TestExpeditionReadHandlerList(t *testing.T) {
	userID := uuid.New()
	record := testExpeditionRecord(userID)

	tests := []struct {
		name          string
		target        string
		wantFilter    expedition.ListFilter
		listErr       error
		noAuthHeader  bool
		wantStatus    int
		wantErrorCode string
	}{
		{name: "uses defaults", target: "/expeditions", wantFilter: expedition.ListFilter{Limit: 20}, wantStatus: http.StatusOK},
		{name: "caps limit", target: "/expeditions?limit=101&offset=3", wantFilter: expedition.ListFilter{Limit: 100, Offset: 3}, wantStatus: http.StatusOK},
		{name: "rejects invalid offset", target: "/expeditions?offset=-1", wantStatus: http.StatusUnprocessableEntity, wantErrorCode: "VALIDATION_FAILED"},
		{name: "rejects offset exceeding database range", target: "/expeditions?offset=2147483648", wantStatus: http.StatusUnprocessableEntity, wantErrorCode: "VALIDATION_FAILED"},
		{name: "returns internal error", target: "/expeditions", wantFilter: expedition.ListFilter{Limit: 20}, listErr: errors.New("database unavailable"), wantStatus: http.StatusInternalServerError, wantErrorCode: "INTERNAL_ERROR"},
		{name: "requires authentication", target: "/expeditions", noAuthHeader: true, wantStatus: http.StatusUnauthorized, wantErrorCode: "AUTH_MISSING_HEADER"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			called := false
			router, signer := newTestExpeditionReadRouter(t, &mockExpeditionManager{list: func(_ context.Context, gotUserID uuid.UUID, filter expedition.ListFilter) ([]expedition.Record, error) {
				called = true
				if gotUserID != userID || filter != test.wantFilter {
					t.Errorf("List args = %s, %+v, want %s, %+v", gotUserID, filter, userID, test.wantFilter)
				}
				return []expedition.Record{record}, test.listErr
			}})
			req := httptest.NewRequest(http.MethodGet, test.target, nil)
			if !test.noAuthHeader {
				req.Header.Set("Authorization", "Bearer "+signer.token(t, userID.String()))
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			sharedhttptest.WantStatus(t, rec, test.wantStatus)
			if test.wantErrorCode != "" {
				sharedhttptest.WantErrorCode(t, rec, test.wantErrorCode)
				if (test.target != "/expeditions" || test.noAuthHeader) && called {
					t.Error("manager was called for invalid pagination or an unauthenticated request")
				}
				return
			}
			var response []expeditionResponse
			sharedhttptest.DecodeBody(t, rec, &response)
			if len(response) != 1 {
				t.Fatalf("response length = %d, want 1", len(response))
			}
			assertExpeditionResponse(t, response[0], record)
		})
	}
}

func testExpeditionRecord(userID uuid.UUID) expedition.Record {
	createdAt := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	return expedition.Record{ID: uuid.New(), UserID: userID, MaterialsInvested: 10, SuccessChance: 0.5, ResolveAt: createdAt.Add(7 * 24 * time.Hour), Status: "IN_FLIGHT", CreatedAt: createdAt}
}

func assertExpeditionResponse(t *testing.T, response expeditionResponse, record expedition.Record) {
	t.Helper()
	if response.ID != record.ID.String() || response.UserID != record.UserID.String() || response.MaterialsInvested != record.MaterialsInvested || response.SuccessChance != record.SuccessChance || response.ResolveAt != record.ResolveAt.Format(time.RFC3339Nano) || response.Status != record.Status || response.CreatedAt != record.CreatedAt.Format(time.RFC3339Nano) {
		t.Errorf("response = %+v, want expedition %+v", response, record)
	}
}
