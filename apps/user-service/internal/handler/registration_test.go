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
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
)

type mockRegistrationStore struct {
	insertUser func(ctx context.Context, arg database.InsertUserParams) (database.User, error)
}

func (m *mockRegistrationStore) InsertUser(ctx context.Context, arg database.InsertUserParams) (database.User, error) {
	if m.insertUser != nil {
		return m.insertUser(ctx, arg)
	}
	return database.User{}, errors.New("unexpected InsertUser call")
}

func newTestRegistrationHandler(t *testing.T, store registrationStore, refreshStore refreshTokenStore, publisher EventPublisher) *RegistrationHandler {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	tokenIssuer := NewTokenIssuer(priv, "test-key", refreshStore)
	return NewRegistrationHandler(store, tokenIssuer, publisher, logger)
}

func TestSignup(t *testing.T) {
	userID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	createdAt := pgtype.Timestamptz{Time: time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC), Valid: true}
	updatedAt := pgtype.Timestamptz{Time: time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC), Valid: true}

	tests := []struct {
		name              string
		body              string
		setupStore        func(m *mockRegistrationStore)
		setupRefreshStore func(m *mockRefreshTokenStore)
		setupPublisher    func(m *mockPublisher)
		wantStatus        int
		wantFieldError    map[string]string
		wantErrorCode     string
		assertResponse    func(t *testing.T, resp signupResponse)
		assertPublished   func(t *testing.T, calls []publishCall)
	}{
		{
			name: "creates user",
			body: `{"email":"user@example.com","username":"spacecadet","password":"secret123"}`,
			setupStore: func(m *mockRegistrationStore) {
				m.insertUser = func(ctx context.Context, arg database.InsertUserParams) (database.User, error) {
					if arg.Email != "user@example.com" {
						t.Errorf("email = %q, want user@example.com", arg.Email)
					}
					if arg.Username != "spacecadet" {
						t.Errorf("username = %q, want spacecadet", arg.Username)
					}
					if arg.PasswordHash == "" {
						t.Error("password hash is empty")
					}
					return database.User{
						ID:           userID,
						Email:        arg.Email,
						Username:     arg.Username,
						PasswordHash: arg.PasswordHash,
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
			wantStatus: http.StatusCreated,
			assertResponse: func(t *testing.T, resp signupResponse) {
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
			assertPublished: func(t *testing.T, calls []publishCall) {
				if len(calls) != 1 {
					t.Fatalf("published events = %d, want 1", len(calls))
				}
				if calls[0].EventType != "user.created" {
					t.Errorf("event type = %q, want user.created", calls[0].EventType)
				}
			},
		},
		{
			name:           "missing email",
			body:           `{"username":"spacecadet","password":"secret123"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"email": "email is required"},
		},
		{
			name:           "invalid email",
			body:           `{"email":"not-an-email","username":"spacecadet","password":"secret123"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"email": "invalid email format"},
		},
		{
			name:           "missing username",
			body:           `{"email":"user@example.com","password":"secret123"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"username": "username is required"},
		},
		{
			name:           "invalid username",
			body:           `{"email":"user@example.com","username":"ab","password":"secret123"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"username": "username must be 3-30 characters and contain only letters, numbers, underscores, and hyphens"},
		},
		{
			name:           "short password",
			body:           `{"email":"user@example.com","username":"spacecadet","password":"short"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"password": "password must be at least 8 characters"},
		},
		{
			name: "email already registered",
			body: `{"email":"user@example.com","username":"spacecadet","password":"secret123"}`,
			setupStore: func(m *mockRegistrationStore) {
				m.insertUser = func(ctx context.Context, arg database.InsertUserParams) (database.User, error) {
					return database.User{}, &pgconn.PgError{Code: "23505", ConstraintName: "users_email_key"}
				}
			},
			wantStatus:    http.StatusConflict,
			wantErrorCode: "USER_EMAIL_TAKEN",
		},
		{
			name: "username already taken",
			body: `{"email":"user@example.com","username":"spacecadet","password":"secret123"}`,
			setupStore: func(m *mockRegistrationStore) {
				m.insertUser = func(ctx context.Context, arg database.InsertUserParams) (database.User, error) {
					return database.User{}, &pgconn.PgError{Code: "23505", ConstraintName: "users_username_lower_idx"}
				}
			},
			wantStatus:    http.StatusConflict,
			wantErrorCode: "USER_USERNAME_TAKEN",
		},
		{
			name: "publisher failure rolls back response to 500",
			body: `{"email":"user@example.com","username":"spacecadet","password":"secret123"}`,
			setupStore: func(m *mockRegistrationStore) {
				m.insertUser = func(ctx context.Context, arg database.InsertUserParams) (database.User, error) {
					return database.User{ID: userID, Email: arg.Email, Username: arg.Username}, nil
				}
			},
			setupRefreshStore: func(m *mockRefreshTokenStore) {
				m.insertRefreshToken = func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
					return database.RefreshToken{}, nil
				}
			},
			setupPublisher: func(m *mockPublisher) {
				m.err = errors.New("broker unreachable")
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
		{
			name: "insert user store error",
			body: `{"email":"user@example.com","username":"spacecadet","password":"secret123"}`,
			setupStore: func(m *mockRegistrationStore) {
				m.insertUser = func(ctx context.Context, arg database.InsertUserParams) (database.User, error) {
					return database.User{}, errors.New("database down")
				}
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &mockRegistrationStore{}
			refreshStore := &mockRefreshTokenStore{}
			publisher := &mockPublisher{}
			if tt.setupStore != nil {
				tt.setupStore(store)
			}
			if tt.setupRefreshStore != nil {
				tt.setupRefreshStore(refreshStore)
			}
			if tt.setupPublisher != nil {
				tt.setupPublisher(publisher)
			}

			handler := newTestRegistrationHandler(t, store, refreshStore, publisher)
			rec := httptest.NewRecorder()
			req := newTestRequest(t, http.MethodPost, "/users", tt.body)

			handler.Signup(rec, req)

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

			var resp signupResponse
			decodeBody(t, rec, &resp)
			if tt.assertResponse != nil {
				tt.assertResponse(t, resp)
			}
			if tt.assertPublished != nil {
				tt.assertPublished(t, publisher.published)
			}
		})
	}
}

func TestSignupAccessTokenIsValid(t *testing.T) {
	userID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	store := &mockRegistrationStore{
		insertUser: func(ctx context.Context, arg database.InsertUserParams) (database.User, error) {
			return database.User{ID: userID, Email: arg.Email, Username: arg.Username}, nil
		},
	}
	refreshStore := &mockRefreshTokenStore{
		insertRefreshToken: func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
			return database.RefreshToken{}, nil
		},
	}
	handler := newTestRegistrationHandler(t, store, refreshStore, &mockPublisher{})

	rec := httptest.NewRecorder()
	req := newTestRequest(t, http.MethodPost, "/users", `{"email":"user@example.com","username":"spacecadet","password":"secret123"}`)

	handler.Signup(rec, req)

	var resp signupResponse
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
