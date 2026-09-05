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
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
)

type mockSessionStore struct {
	getUserByEmail              func(ctx context.Context, email string) (database.User, error)
	getRefreshTokenByToken      func(ctx context.Context, token string) (database.RefreshToken, error)
	markRefreshTokenUsed        func(ctx context.Context, id int64) error
	deleteRefreshTokensByFamily func(ctx context.Context, familyID pgtype.UUID) error
	insertRefreshToken          func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error)
	getUserByID                 func(ctx context.Context, id pgtype.UUID) (database.User, error)
}

func (m *mockSessionStore) GetUserByEmail(ctx context.Context, email string) (database.User, error) {
	if m.getUserByEmail != nil {
		return m.getUserByEmail(ctx, email)
	}
	return database.User{}, errors.New("unexpected GetUserByEmail call")
}

func (m *mockSessionStore) GetRefreshTokenByToken(ctx context.Context, token string) (database.RefreshToken, error) {
	if m.getRefreshTokenByToken != nil {
		return m.getRefreshTokenByToken(ctx, token)
	}
	return database.RefreshToken{}, errors.New("unexpected GetRefreshTokenByToken call")
}

func (m *mockSessionStore) MarkRefreshTokenUsed(ctx context.Context, id int64) error {
	if m.markRefreshTokenUsed != nil {
		return m.markRefreshTokenUsed(ctx, id)
	}
	return errors.New("unexpected MarkRefreshTokenUsed call")
}

func (m *mockSessionStore) DeleteRefreshTokensByFamilyID(ctx context.Context, familyID pgtype.UUID) error {
	if m.deleteRefreshTokensByFamily != nil {
		return m.deleteRefreshTokensByFamily(ctx, familyID)
	}
	return errors.New("unexpected DeleteRefreshTokensByFamilyID call")
}

func (m *mockSessionStore) InsertRefreshToken(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
	if m.insertRefreshToken != nil {
		return m.insertRefreshToken(ctx, arg)
	}
	return database.RefreshToken{}, errors.New("unexpected InsertRefreshToken call")
}

func (m *mockSessionStore) GetUserByID(ctx context.Context, id pgtype.UUID) (database.User, error) {
	if m.getUserByID != nil {
		return m.getUserByID(ctx, id)
	}
	return database.User{}, errors.New("unexpected GetUserByID call")
}

func newTestSessionHandler(t *testing.T, store sessionStore, refreshStore refreshTokenStore) *SessionHandler {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	tokenIssuer := NewTokenIssuer(priv, "test-key", refreshStore)
	return NewSessionHandler(store, tokenIssuer, logger)
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

			handler := newTestSessionHandler(t, store, refreshStore)
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
	handler := newTestSessionHandler(t, store, refreshStore)

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
	userID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	familyID := pgtype.UUID{Bytes: uuid.New(), Valid: true}

	validToken := database.RefreshToken{
		ID:        1,
		UserID:    userID,
		Token:     "valid-token",
		FamilyID:  familyID,
		Used:      false,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(7 * 24 * time.Hour), Valid: true},
	}

	usedToken := database.RefreshToken{
		ID:        2,
		UserID:    userID,
		Token:     "used-token",
		FamilyID:  familyID,
		Used:      true,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(7 * 24 * time.Hour), Valid: true},
	}

	expiredToken := database.RefreshToken{
		ID:        3,
		UserID:    userID,
		Token:     "expired-token",
		FamilyID:  familyID,
		Used:      false,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true},
	}

	tests := []struct {
		name           string
		body           string
		setupStore     func(m *mockSessionStore)
		wantStatus     int
		wantFieldError map[string]string
		wantErrorCode  string
		assertResponse func(t *testing.T, resp refreshResponse)
	}{
		{
			name: "rotates valid token",
			body: `{"refresh_token":"valid-token"}`,
			setupStore: func(m *mockSessionStore) {
				m.getRefreshTokenByToken = func(ctx context.Context, token string) (database.RefreshToken, error) {
					if token != "valid-token" {
						t.Errorf("token = %q, want valid-token", token)
					}
					return validToken, nil
				}
				m.markRefreshTokenUsed = func(ctx context.Context, id int64) error {
					if id != 1 {
						t.Errorf("id = %d, want 1", id)
					}
					return nil
				}
				m.insertRefreshToken = func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
					if arg.UserID != userID {
						t.Error("user_id mismatch")
					}
					if arg.Token == "" {
						t.Error("new token is empty")
					}
					if arg.FamilyID != familyID {
						t.Error("family_id mismatch")
					}
					return database.RefreshToken{Token: arg.Token}, nil
				}
				m.getUserByID = func(ctx context.Context, id pgtype.UUID) (database.User, error) {
					if id != userID {
						t.Error("user_id mismatch in GetUserByID")
					}
					return database.User{ID: userID, Email: "user@example.com", Username: "spacecadet"}, nil
				}
			},
			wantStatus: http.StatusOK,
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
			setupStore: func(m *mockSessionStore) {
				m.getRefreshTokenByToken = func(ctx context.Context, token string) (database.RefreshToken, error) {
					return database.RefreshToken{}, pgx.ErrNoRows
				}
			},
			wantStatus:    http.StatusUnauthorized,
			wantErrorCode: "AUTH_INVALID_TOKEN",
		},
		{
			name: "token already used - nukes family",
			body: `{"refresh_token":"used-token"}`,
			setupStore: func(m *mockSessionStore) {
				familyDeleted := false
				m.getRefreshTokenByToken = func(ctx context.Context, token string) (database.RefreshToken, error) {
					return usedToken, nil
				}
				m.deleteRefreshTokensByFamily = func(ctx context.Context, fid pgtype.UUID) error {
					if fid != familyID {
						t.Error("family_id mismatch in delete")
					}
					familyDeleted = true
					return nil
				}
				t.Cleanup(func() {
					if !familyDeleted {
						t.Error("family was not deleted on reuse detection")
					}
				})
			},
			wantStatus:    http.StatusUnauthorized,
			wantErrorCode: "AUTH_INVALID_TOKEN",
		},
		{
			name: "expired token",
			body: `{"refresh_token":"expired-token"}`,
			setupStore: func(m *mockSessionStore) {
				m.getRefreshTokenByToken = func(ctx context.Context, token string) (database.RefreshToken, error) {
					return expiredToken, nil
				}
			},
			wantStatus:    http.StatusUnauthorized,
			wantErrorCode: "AUTH_INVALID_TOKEN",
		},
		{
			name: "get user by id error after rotation",
			body: `{"refresh_token":"valid-token"}`,
			setupStore: func(m *mockSessionStore) {
				m.getRefreshTokenByToken = func(ctx context.Context, token string) (database.RefreshToken, error) {
					return validToken, nil
				}
				m.markRefreshTokenUsed = func(ctx context.Context, id int64) error { return nil }
				m.insertRefreshToken = func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
					return database.RefreshToken{Token: arg.Token}, nil
				}
				m.getUserByID = func(ctx context.Context, id pgtype.UUID) (database.User, error) {
					return database.User{}, errors.New("db down")
				}
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &mockSessionStore{}
			if tt.setupStore != nil {
				tt.setupStore(store)
			}

			handler := newTestSessionHandler(t, store, &mockRefreshTokenStore{
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
	userID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	familyID := pgtype.UUID{Bytes: uuid.New(), Valid: true}

	validToken := database.RefreshToken{
		ID:        1,
		UserID:    userID,
		Token:     "valid-token",
		FamilyID:  familyID,
		Used:      false,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(7 * 24 * time.Hour), Valid: true},
	}

	store := &mockSessionStore{
		getRefreshTokenByToken: func(ctx context.Context, token string) (database.RefreshToken, error) {
			return validToken, nil
		},
		markRefreshTokenUsed: func(ctx context.Context, id int64) error { return nil },
		insertRefreshToken: func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
			return database.RefreshToken{Token: arg.Token}, nil
		},
		getUserByID: func(ctx context.Context, id pgtype.UUID) (database.User, error) {
			return database.User{ID: userID, Email: "user@example.com", Username: "spacecadet"}, nil
		},
	}

	handler := newTestSessionHandler(t, store, &mockRefreshTokenStore{
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
	if claims.Subject != uuid.UUID(userID.Bytes).String() {
		t.Errorf("subject = %q, want %q", claims.Subject, uuid.UUID(userID.Bytes).String())
	}
	if claims.Email != "user@example.com" {
		t.Errorf("email claim = %q, want user@example.com", claims.Email)
	}
}
