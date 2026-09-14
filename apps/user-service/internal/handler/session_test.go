package handler

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
	usersession "github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/session"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
)

type mockSessionStore struct {
	getUserByEmail func(ctx context.Context, email string) (database.User, error)
}

type mockSessionManager struct {
	rotate func(context.Context, string) (usersession.Rotation, error)
	logout func(context.Context, string) error
}

func (m *mockSessionManager) Rotate(ctx context.Context, token string) (usersession.Rotation, error) {
	if m.rotate != nil {
		return m.rotate(ctx, token)
	}
	return usersession.Rotation{}, errors.New("unexpected Rotate call")
}

func (m *mockSessionManager) Logout(ctx context.Context, token string) error {
	if m.logout != nil {
		return m.logout(ctx, token)
	}
	return errors.New("unexpected Logout call")
}

func (m *mockSessionStore) GetUserByEmail(ctx context.Context, email string) (database.User, error) {
	if m.getUserByEmail != nil {
		return m.getUserByEmail(ctx, email)
	}
	return database.User{}, errors.New("unexpected GetUserByEmail call")
}

func newTestSessionHandler(t *testing.T, store sessionStore, manager usersession.Manager, refreshStore refreshTokenStore) *SessionHandler {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	tokenIssuer := NewTokenIssuer(priv, "test-key", refreshStore)
	return NewSessionHandler(store, manager, tokenIssuer, logger)
}

func TestLogin(t *testing.T) {
	userID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	createdAt := pgtype.Timestamptz{Time: time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC), Valid: true}
	updatedAt := pgtype.Timestamptz{Time: time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC), Valid: true}

	tests := []struct {
		name              string
		body              string
		setupStore        func(m *mockSessionStore)
		setupRefreshStore func(m *mockRefreshTokenStore)
		wantStatus        int
		wantFieldError    map[string]string
		wantErrorCode     string
		assertResponse    func(t *testing.T, resp loginResponse)
	}{
		{
			name: "logs in existing user",
			body: `{"email":"user@example.com","password":"secret123"}`,
			setupStore: func(m *mockSessionStore) {
				passwordHash, _ := auth.HashPassword("secret123")
				m.getUserByEmail = func(ctx context.Context, email string) (database.User, error) {
					if email != "user@example.com" {
						t.Errorf("email = %q, want user@example.com", email)
					}
					return database.User{
						ID:           userID,
						Email:        "user@example.com",
						Username:     "spacecadet",
						PasswordHash: passwordHash,
						CreatedAt:    createdAt,
						UpdatedAt:    updatedAt,
					}, nil
				}
			},
			setupRefreshStore: func(m *mockRefreshTokenStore) {
				m.insertRefreshToken = func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
					if arg.UserID != userID {
						t.Errorf("user_id mismatch")
					}
					if arg.Token == "" {
						t.Error("refresh token is empty")
					}
					if !arg.FamilyID.Valid {
						t.Error("family_id is invalid")
					}
					if !arg.ExpiresAt.Valid {
						t.Error("expires_at is invalid")
					}
					return database.RefreshToken{}, nil
				}
			},
			wantStatus: http.StatusOK,
			assertResponse: func(t *testing.T, resp loginResponse) {
				if resp.User.Email != "user@example.com" {
					t.Errorf("user.email = %q, want user@example.com", resp.User.Email)
				}
				if resp.User.Username != "spacecadet" {
					t.Errorf("user.username = %q, want spacecadet", resp.User.Username)
				}
				if resp.AccessToken == "" {
					t.Error("access_token is empty")
				}
				if resp.RefreshToken == "" {
					t.Error("refresh_token is empty")
				}
			},
		},
		{
			name:           "missing email",
			body:           `{"password":"secret123"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"email": "email is required"},
		},
		{
			name:           "missing password",
			body:           `{"email":"user@example.com"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"password": "password is required"},
		},
		{
			name: "user not found",
			body: `{"email":"unknown@example.com","password":"secret123"}`,
			setupStore: func(m *mockSessionStore) {
				m.getUserByEmail = func(ctx context.Context, email string) (database.User, error) {
					return database.User{}, pgx.ErrNoRows
				}
			},
			wantStatus:    http.StatusUnauthorized,
			wantErrorCode: "USER_INVALID_CREDENTIALS",
		},
		{
			name: "wrong password",
			body: `{"email":"user@example.com","password":"wrongpassword"}`,
			setupStore: func(m *mockSessionStore) {
				passwordHash, _ := auth.HashPassword("secret123")
				m.getUserByEmail = func(ctx context.Context, email string) (database.User, error) {
					return database.User{
						ID:           userID,
						Email:        "user@example.com",
						Username:     "spacecadet",
						PasswordHash: passwordHash,
						CreatedAt:    createdAt,
						UpdatedAt:    updatedAt,
					}, nil
				}
			},
			wantStatus:    http.StatusUnauthorized,
			wantErrorCode: "USER_INVALID_CREDENTIALS",
		},
		{
			name: "get user store error",
			body: `{"email":"user@example.com","password":"secret123"}`,
			setupStore: func(m *mockSessionStore) {
				m.getUserByEmail = func(ctx context.Context, email string) (database.User, error) {
					return database.User{}, errors.New("database down")
				}
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &mockSessionStore{}
			refreshStore := &mockRefreshTokenStore{}
			if tt.setupStore != nil {
				tt.setupStore(store)
			}
			if tt.setupRefreshStore != nil {
				tt.setupRefreshStore(refreshStore)
			}

			handler := newTestSessionHandler(t, store, &mockSessionManager{}, refreshStore)
			rec := httptest.NewRecorder()
			req := newTestRequest(t, http.MethodPost, "/auth/login", tt.body)

			handler.Login(rec, req)

			wantStatus(t, rec, tt.wantStatus)

			if tt.wantFieldError != nil {
				for field, wantMessage := range tt.wantFieldError {
					wantFieldError(t, rec, field, wantMessage)
				}
				return
			}

			if tt.wantErrorCode != "" {
				wantErrorCode(t, rec, tt.wantErrorCode)
				return
			}

			var resp loginResponse
			decodeBody(t, rec, &resp)
			if tt.assertResponse != nil {
				tt.assertResponse(t, resp)
			}
		})
	}
}

func TestLoginAccessTokenIsValid(t *testing.T) {
	userID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	passwordHash, err := auth.HashPassword("secret123")
	if err != nil {
		t.Fatal(err)
	}

	store := &mockSessionStore{
		getUserByEmail: func(ctx context.Context, email string) (database.User, error) {
			return database.User{ID: userID, Email: "user@example.com", Username: "spacecadet", PasswordHash: passwordHash}, nil
		},
	}
	refreshStore := &mockRefreshTokenStore{
		insertRefreshToken: func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
			return database.RefreshToken{}, nil
		},
	}
	handler := newTestSessionHandler(t, store, &mockSessionManager{}, refreshStore)

	rec := httptest.NewRecorder()
	req := newTestRequest(t, http.MethodPost, "/auth/login", `{"email":"user@example.com","password":"secret123"}`)

	handler.Login(rec, req)

	var resp loginResponse
	decodeBody(t, rec, &resp)

	claims, err := auth.VerifyAccessToken(handler.tokenIssuer.privateKey.Public(), resp.AccessToken)
	if err != nil {
		t.Fatalf("verify access token: %v", err)
	}
	if claims.Subject != uuid.UUID(userID.Bytes).String() {
		t.Errorf("subject = %q, want %q", claims.Subject, uuid.UUID(userID.Bytes).String())
	}
	if claims.Email != "user@example.com" {
		t.Errorf("email claim = %q, want user@example.com", claims.Email)
	}
}

func TestRefresh(t *testing.T) {
	userID := uuid.New()

	tests := []struct {
		name            string
		body            string
		setupManager    func(m *mockSessionManager)
		wantRotateToken string
		wantStatus      int
		wantFieldError  map[string]string
		wantErrorCode   string
		assertResponse  func(t *testing.T, resp refreshResponse)
	}{
		{
			name: "rotates valid token",
			body: `{"refresh_token":"valid-token"}`,
			setupManager: func(m *mockSessionManager) {
				m.rotate = func(context.Context, string) (usersession.Rotation, error) {
					return usersession.Rotation{RefreshToken: "replacement-token", UserID: userID, Email: "user@example.com"}, nil
				}
			},
			wantRotateToken: "valid-token",
			wantStatus:      http.StatusOK,
			assertResponse: func(t *testing.T, resp refreshResponse) {
				if resp.AccessToken == "" {
					t.Error("access_token is empty")
				}
				if resp.RefreshToken == "" {
					t.Error("refresh_token is empty")
				}
			},
		},
		{
			name:           "missing refresh_token field",
			body:           `{}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"refresh_token": "refresh_token is required"},
		},
		{
			name: "token not found",
			body: `{"refresh_token":"does-not-exist"}`,
			setupManager: func(m *mockSessionManager) {
				m.rotate = func(context.Context, string) (usersession.Rotation, error) {
					return usersession.Rotation{}, usersession.ErrInvalidRefreshToken
				}
			},
			wantRotateToken: "does-not-exist",
			wantStatus:      http.StatusUnauthorized,
			wantErrorCode:   "AUTH_INVALID_TOKEN",
		},
		{
			name: "token already used - nukes family",
			body: `{"refresh_token":"used-token"}`,
			setupManager: func(m *mockSessionManager) {
				m.rotate = func(context.Context, string) (usersession.Rotation, error) {
					return usersession.Rotation{}, usersession.ErrInvalidRefreshToken
				}
			},
			wantRotateToken: "used-token",
			wantStatus:      http.StatusUnauthorized,
			wantErrorCode:   "AUTH_INVALID_TOKEN",
		},
		{
			name: "expired token",
			body: `{"refresh_token":"expired-token"}`,
			setupManager: func(m *mockSessionManager) {
				m.rotate = func(context.Context, string) (usersession.Rotation, error) {
					return usersession.Rotation{}, usersession.ErrInvalidRefreshToken
				}
			},
			wantRotateToken: "expired-token",
			wantStatus:      http.StatusUnauthorized,
			wantErrorCode:   "AUTH_INVALID_TOKEN",
		},
		{
			name: "refresh infrastructure outage",
			body: `{"refresh_token":"valid-token"}`,
			setupManager: func(m *mockSessionManager) {
				m.rotate = func(context.Context, string) (usersession.Rotation, error) {
					return usersession.Rotation{}, fmt.Errorf("refresh database: %w", usersession.ErrRefreshUnavailable)
				}
			},
			wantRotateToken: "valid-token",
			wantStatus:      http.StatusServiceUnavailable,
			wantErrorCode:   "AUTH_SERVICE_UNAVAILABLE",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &mockSessionStore{}
			manager := &mockSessionManager{}
			if tt.setupManager != nil {
				tt.setupManager(manager)
			}
			if manager.rotate != nil && tt.wantRotateToken != "" {
				rotate := manager.rotate
				manager.rotate = func(ctx context.Context, token string) (usersession.Rotation, error) {
					if token != tt.wantRotateToken {
						t.Errorf("forwarded refresh token = %q, want %q", token, tt.wantRotateToken)
					}
					return rotate(ctx, token)
				}
			}

			handler := newTestSessionHandler(t, store, manager, &mockRefreshTokenStore{
				insertRefreshToken: func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
					return database.RefreshToken{}, nil
				},
			})
			rec := httptest.NewRecorder()
			req := newTestRequest(t, http.MethodPost, "/auth/refresh", tt.body)

			handler.Refresh(rec, req)

			wantStatus(t, rec, tt.wantStatus)

			if tt.wantFieldError != nil {
				for field, wantMessage := range tt.wantFieldError {
					wantFieldError(t, rec, field, wantMessage)
				}
				return
			}

			if tt.wantErrorCode != "" {
				wantErrorCode(t, rec, tt.wantErrorCode)
				return
			}

			var resp refreshResponse
			decodeBody(t, rec, &resp)
			if tt.assertResponse != nil {
				tt.assertResponse(t, resp)
			}
		})
	}
}

func TestRefreshAccessTokenIsValid(t *testing.T) {
	userID := uuid.New()
	store := &mockSessionStore{}

	handler := newTestSessionHandler(t, store, &mockSessionManager{rotate: func(context.Context, string) (usersession.Rotation, error) {
		return usersession.Rotation{RefreshToken: "replacement-token", UserID: userID, Email: "user@example.com"}, nil
	}}, &mockRefreshTokenStore{
		insertRefreshToken: func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
			return database.RefreshToken{}, nil
		},
	})

	rec := httptest.NewRecorder()
	req := newTestRequest(t, http.MethodPost, "/auth/refresh", `{"refresh_token":"valid-token"}`)

	handler.Refresh(rec, req)

	var resp refreshResponse
	decodeBody(t, rec, &resp)

	claims, err := auth.VerifyAccessToken(handler.tokenIssuer.privateKey.Public(), resp.AccessToken)
	if err != nil {
		t.Fatalf("verify access token: %v", err)
	}
	if claims.Subject != userID.String() {
		t.Errorf("subject = %q, want %q", claims.Subject, userID.String())
	}
	if claims.Email != "user@example.com" {
		t.Errorf("email claim = %q, want user@example.com", claims.Email)
	}
}

func TestLogout(t *testing.T) {
	tests := []struct {
		name          string
		body          string
		manager       *mockSessionManager
		wantStatus    int
		wantErrorCode string
	}{
		{
			name: "revokes presented token family",
			body: `{"refresh_token":"current-token"}`,
			manager: &mockSessionManager{logout: func(_ context.Context, token string) error {
				if token != "current-token" {
					t.Errorf("logout token = %q, want current-token", token)
				}
				return nil
			}},
			wantStatus: http.StatusNoContent,
		},
		{
			name:          "missing refresh token",
			body:          `{}`,
			manager:       &mockSessionManager{},
			wantStatus:    http.StatusUnprocessableEntity,
			wantErrorCode: "VALIDATION_FAILED",
		},
		{
			name:          "logout infrastructure failure",
			body:          `{"refresh_token":"current-token"}`,
			manager:       &mockSessionManager{logout: func(context.Context, string) error { return errors.New("database down") }},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := newTestSessionHandler(t, &mockSessionStore{}, tt.manager, &mockRefreshTokenStore{})
			rec := httptest.NewRecorder()
			handler.Logout(rec, newTestRequest(t, http.MethodPost, "/auth/logout", tt.body))
			wantStatus(t, rec, tt.wantStatus)
			if tt.wantErrorCode != "" {
				wantErrorCode(t, rec, tt.wantErrorCode)
			}
		})
	}
}
