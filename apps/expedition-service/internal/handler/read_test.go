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
	quote   func(context.Context, uuid.UUID, int32) (expedition.Quote, error)
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

func (m *mockExpeditionManager) Quote(ctx context.Context, userID uuid.UUID, materialsInvested int32) (expedition.Quote, error) {
	if m.quote == nil {
		return expedition.Quote{}, errors.New("unexpected Quote call")
	}
	return m.quote(ctx, userID, materialsInvested)
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
		{name: "returns ship state not ready", currentErr: expedition.ErrShipStateNotReady, wantStatus: http.StatusServiceUnavailable, wantErrorCode: expeditionShipStateNotReadyCode},
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
	record.Result = &expedition.Result{ID: resultID, ExpeditionID: expeditionID, Outcome: "SUCCESS", MaterialsReward: 20, CreatedAt: record.CreatedAt}

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
			if response.Result != nil && response.Result.MaterialReward.Materials != 20 {
				t.Errorf("material_reward.materials = %d, want 20", response.Result.MaterialReward.Materials)
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

func TestExpeditionReadHandlerQuote(t *testing.T) {
	userID := uuid.New()
	now := time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)
	cooldownUntil := now.Add(7 * 24 * time.Hour)
	quote := expedition.Quote{
		MaterialsInvested:      10,
		NormalizedInvestment:   0.5,
		ProjectedBalance:       15,
		SuccessChance:          0.4,
		Eligible:               true,
		EstimatedResolveAt:     now.Add(7 * 24 * time.Hour),
		EstimatedResolveWindow: 24 * time.Hour,
	}

	tests := []struct {
		name          string
		target        string
		quote         expedition.Quote
		quoteErr      error
		noAuthHeader  bool
		wantStatus    int
		wantErrorCode string
		wantManager   bool
	}{
		{name: "returns eligible quote", target: "/expeditions/quote?materials_invested=10", quote: quote, wantStatus: http.StatusOK, wantManager: true},
		{
			name: "returns blocked quote", target: "/expeditions/quote?materials_invested=30",
			quote: expedition.Quote{
				MaterialsInvested: 30, NormalizedInvestment: 0.75, ProjectedBalance: -5, SuccessChance: 0.6,
				Blocker: expedition.BlockerInsufficientMaterials, EstimatedResolveAt: now.Add(7 * 24 * time.Hour),
			},
			wantStatus: http.StatusOK, wantManager: true,
		},
		{
			name: "returns cooldown quote", target: "/expeditions/quote?materials_invested=10",
			quote: expedition.Quote{
				MaterialsInvested: 10, NormalizedInvestment: 0.5, ProjectedBalance: 15, SuccessChance: 0.4,
				Blocker: expedition.BlockerCooldown, CooldownUntil: &cooldownUntil,
				EstimatedResolveAt: now.Add(7 * 24 * time.Hour),
			},
			wantStatus: http.StatusOK, wantManager: true,
		},
		{name: "rejects missing materials", target: "/expeditions/quote", wantStatus: http.StatusUnprocessableEntity, wantErrorCode: "VALIDATION_FAILED"},
		{name: "rejects zero materials", target: "/expeditions/quote?materials_invested=0", wantStatus: http.StatusUnprocessableEntity, wantErrorCode: "VALIDATION_FAILED"},
		{name: "rejects materials outside database range", target: "/expeditions/quote?materials_invested=2147483648", wantStatus: http.StatusUnprocessableEntity, wantErrorCode: "VALIDATION_FAILED"},
		{name: "rejects non-numeric materials", target: "/expeditions/quote?materials_invested=abc", wantStatus: http.StatusUnprocessableEntity, wantErrorCode: "VALIDATION_FAILED"},
		{name: "maps ship state not ready", target: "/expeditions/quote?materials_invested=10", quoteErr: expedition.ErrShipStateNotReady, wantStatus: http.StatusServiceUnavailable, wantErrorCode: expeditionShipStateNotReadyCode, wantManager: true},
		{name: "maps internal error", target: "/expeditions/quote?materials_invested=10", quoteErr: errors.New("database unavailable"), wantStatus: http.StatusInternalServerError, wantErrorCode: "INTERNAL_ERROR", wantManager: true},
		{name: "requires authentication", target: "/expeditions/quote?materials_invested=10", noAuthHeader: true, wantStatus: http.StatusUnauthorized, wantErrorCode: "AUTH_MISSING_HEADER"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			called := false
			router, signer := newTestExpeditionReadRouter(t, &mockExpeditionManager{quote: func(_ context.Context, gotUserID uuid.UUID, materialsInvested int32) (expedition.Quote, error) {
				called = true
				if gotUserID != userID {
					t.Errorf("Quote user_id = %s, want %s", gotUserID, userID)
				}
				if materialsInvested <= 0 {
					t.Errorf("Quote materials = %d, want positive", materialsInvested)
				}
				return test.quote, test.quoteErr
			}})
			req := httptest.NewRequest(http.MethodGet, test.target, nil)
			if !test.noAuthHeader {
				req.Header.Set("Authorization", "Bearer "+signer.token(t, userID.String()))
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			sharedhttptest.WantStatus(t, rec, test.wantStatus)
			if called != test.wantManager {
				t.Errorf("manager called = %t, want %t", called, test.wantManager)
			}
			if test.wantErrorCode != "" {
				sharedhttptest.WantErrorCode(t, rec, test.wantErrorCode)
				return
			}
			var response expeditionQuoteResponse
			sharedhttptest.DecodeBody(t, rec, &response)
			if response.MaterialsInvested != test.quote.MaterialsInvested ||
				response.NormalizedInvestment != test.quote.NormalizedInvestment ||
				response.ProjectedBalance != test.quote.ProjectedBalance ||
				response.SuccessChance != test.quote.SuccessChance ||
				response.Eligible != test.quote.Eligible ||
				response.EstimatedResolveAt != test.quote.EstimatedResolveAt.Format(time.RFC3339Nano) {
				t.Errorf("quote response = %+v, want %+v", response, test.quote)
			}
			assertQuoteBlocker(t, response, test.quote)
		})
	}
}

func assertQuoteBlocker(t *testing.T, response expeditionQuoteResponse, quote expedition.Quote) {
	t.Helper()
	switch {
	case quote.Blocker == expedition.BlockerNone:
		if response.Blocker != nil {
			t.Errorf("blocker = %q, want null", *response.Blocker)
		}
	case response.Blocker == nil:
		t.Errorf("blocker = null, want %q", quote.Blocker)
	case *response.Blocker != string(quote.Blocker):
		t.Errorf("blocker = %q, want %q", *response.Blocker, quote.Blocker)
	}
	switch {
	case quote.CooldownUntil == nil:
		if response.CooldownUntil != nil {
			t.Errorf("cooldown_until = %q, want null", *response.CooldownUntil)
		}
	case response.CooldownUntil == nil:
		t.Error("cooldown_until = null, want a timestamp")
	case *response.CooldownUntil != quote.CooldownUntil.Format(time.RFC3339Nano):
		t.Errorf("cooldown_until = %q, want %q", *response.CooldownUntil, quote.CooldownUntil.Format(time.RFC3339Nano))
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
