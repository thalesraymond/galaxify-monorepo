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

	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/expedition"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
	sharedhttptest "github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp/test"
)

type launchManagerMock struct {
	launch func(context.Context, uuid.UUID, expedition.LaunchInput) (expedition.Record, error)
}

func (m *launchManagerMock) Launch(ctx context.Context, userID uuid.UUID, input expedition.LaunchInput) (expedition.Record, error) {
	return m.launch(ctx, userID, input)
}

func newTestExpeditionLaunchRouter(t *testing.T, manager expedition.Launcher) (http.Handler, *expeditionTestTokenSigner) {
	t.Helper()
	signer := newExpeditionTestTokenSigner(t)
	launchHandler := NewExpeditionLaunchHandler(
		manager,
		sharedhttp.NewAuthHandshake(auth.NewStaticJWKSCache(signer.kid, signer.priv.Public())),
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	mux := http.NewServeMux()
	launchHandler.RegisterExpeditionLaunchRoutes(mux)
	return sharedhttp.RequestIDMiddleware(mux), signer
}

func TestExpeditionLaunchHandlerLaunch(t *testing.T) {
	userID := uuid.New()
	record := testExpeditionRecord(userID)
	tests := []struct {
		name          string
		body          string
		managerErr    error
		noAuthHeader  bool
		wantStatus    int
		wantErrorCode string
		wantManager   bool
	}{
		{name: "launches expedition", body: `{"materials_invested":10}`, wantStatus: http.StatusCreated, wantManager: true},
		{name: "rejects zero materials", body: `{"materials_invested":0}`, wantStatus: http.StatusUnprocessableEntity, wantErrorCode: "VALIDATION_FAILED"},
		{name: "rejects materials outside database range", body: `{"materials_invested":2147483648}`, wantStatus: http.StatusUnprocessableEntity, wantErrorCode: "VALIDATION_FAILED"},
		{name: "rejects malformed JSON", body: `{`, wantStatus: http.StatusBadRequest, wantErrorCode: "VALIDATION_FAILED"},
		{name: "rejects trailing malformed JSON", body: `{"materials_invested":10} garbage`, wantStatus: http.StatusBadRequest, wantErrorCode: "VALIDATION_FAILED"},
		{name: "maps insufficient materials", body: `{"materials_invested":10}`, managerErr: expedition.ErrInsufficientMaterials, wantStatus: http.StatusUnprocessableEntity, wantErrorCode: expeditionInsufficientMaterialsCode, wantManager: true},
		{name: "maps active expedition", body: `{"materials_invested":10}`, managerErr: expedition.ErrAlreadyActive, wantStatus: http.StatusConflict, wantErrorCode: expeditionAlreadyActiveCode, wantManager: true},
		{name: "maps cooldown", body: `{"materials_invested":10}`, managerErr: expedition.ErrCooldown, wantStatus: http.StatusUnprocessableEntity, wantErrorCode: expeditionCooldownCode, wantManager: true},
		{name: "maps internal error", body: `{"materials_invested":10}`, managerErr: errors.New("database unavailable"), wantStatus: http.StatusInternalServerError, wantErrorCode: "INTERNAL_ERROR", wantManager: true},
		{name: "requires authentication", body: `{"materials_invested":10}`, noAuthHeader: true, wantStatus: http.StatusUnauthorized, wantErrorCode: "AUTH_MISSING_HEADER"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			called := false
			router, signer := newTestExpeditionLaunchRouter(t, &launchManagerMock{launch: func(_ context.Context, gotUserID uuid.UUID, input expedition.LaunchInput) (expedition.Record, error) {
				called = true
				if gotUserID != userID || input.MaterialsInvested != 10 || input.RequestID != "launch-request" {
					t.Errorf("Launch args = %s, %+v, want %s, 10 materials, request ID launch-request", gotUserID, input, userID)
				}
				return record, test.managerErr
			}})
			req := httptest.NewRequest(http.MethodPost, "/expeditions/launch", strings.NewReader(test.body))
			req.Header.Set("X-Request-Id", "launch-request")
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
			var response expeditionResponse
			sharedhttptest.DecodeBody(t, rec, &response)
			assertExpeditionResponse(t, response, record)
		})
	}
}
