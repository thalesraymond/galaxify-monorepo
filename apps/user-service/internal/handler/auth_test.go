package handler

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

type mockAuthStore struct {
	insertUser         func(ctx context.Context, arg database.InsertUserParams) (database.User, error)
	insertRefreshToken func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error)
}

func (m *mockAuthStore) InsertUser(ctx context.Context, arg database.InsertUserParams) (database.User, error) {
	if m.insertUser != nil {
		return m.insertUser(ctx, arg)
	}
	return database.User{}, errors.New("unexpected InsertUser call")
}

func (m *mockAuthStore) InsertRefreshToken(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
	if m.insertRefreshToken != nil {
		return m.insertRefreshToken(ctx, arg)
	}
	return database.RefreshToken{}, errors.New("unexpected InsertRefreshToken call")
}

type mockPublisher struct {
	published []publishCall
	err       error
}

type publishCall struct {
	EventType string
	Payload   any
}

func (m *mockPublisher) Publish(ctx context.Context, eventType string, payload any) error {
	m.published = append(m.published, publishCall{EventType: eventType, Payload: payload})
	return m.err
}

func newTestAuthHandler(t *testing.T, store authStore, publisher EventPublisher) (*AuthHandler, ed25519.PrivateKey) {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewAuthHandler("user-service", priv, "test-key", store, publisher, logger), priv
}

func newTestAuthRouter(t *testing.T, store authStore, publisher EventPublisher) http.Handler {
	t.Helper()
	h, _ := newTestAuthHandler(t, store, publisher)
	mux := http.NewServeMux()
	h.RegisterAuthRoutes(mux)
	return mux
}

func newTestRequest(t *testing.T, method, target, body string) *http.Request {
	t.Helper()
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	return req
}

func wantStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Errorf("status = %d, want %d", rec.Code, want)
	}
}

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.NewDecoder(rec.Body).Decode(v); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
}

func wantErrorCode(t *testing.T, rec *httptest.ResponseRecorder, want string) {
	t.Helper()
	var resp sharedhttp.ErrorResponse
	decodeBody(t, rec, &resp)
	if resp.Error.Code != want {
		t.Errorf("error code = %q, want %q", resp.Error.Code, want)
	}
}

func wantFieldError(t *testing.T, rec *httptest.ResponseRecorder, field, wantMessage string) {
	t.Helper()
	var resp sharedhttp.ErrorResponse
	decodeBody(t, rec, &resp)
	if resp.Error.Code != "VALIDATION_FAILED" {
		t.Errorf("error code = %q, want VALIDATION_FAILED", resp.Error.Code)
	}
	if resp.Error.Details == nil {
		t.Fatalf("expected field errors, got none")
	}
	got, ok := resp.Error.Details.FieldErrors[field]
	if !ok {
		t.Fatalf("missing field error for %q", field)
	}
	if got != wantMessage {
		t.Errorf("field error for %q = %q, want %q", field, got, wantMessage)
	}
}

func TestSignup(t *testing.T) {
	userID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	createdAt := pgtype.Timestamptz{Time: time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC), Valid: true}
	updatedAt := pgtype.Timestamptz{Time: time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC), Valid: true}

	tests := []struct {
		name            string
		body            string
		setupStore      func(m *mockAuthStore)
		setupPublisher  func(m *mockPublisher)
		wantStatus      int
		wantFieldError  map[string]string
		wantErrorCode   string
		assertResponse  func(t *testing.T, resp signupResponse)
		assertPublished func(t *testing.T, calls []publishCall)
		assertStore     func(t *testing.T, store *mockAuthStore)
	}{
		{
			name: "creates user",
			body: `{"email":"user@example.com","username":"spacecadet","password":"secret123"}`,
			setupStore: func(m *mockAuthStore) {
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
			setupStore: func(m *mockAuthStore) {
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
			setupStore: func(m *mockAuthStore) {
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
			setupStore: func(m *mockAuthStore) {
				m.insertUser = func(ctx context.Context, arg database.InsertUserParams) (database.User, error) {
					return database.User{ID: userID, Email: arg.Email, Username: arg.Username}, nil
				}
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
			setupStore: func(m *mockAuthStore) {
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
			store := &mockAuthStore{}
			publisher := &mockPublisher{}
			if tt.setupStore != nil {
				tt.setupStore(store)
			}
			if tt.setupPublisher != nil {
				tt.setupPublisher(publisher)
			}

			handler, _ := newTestAuthHandler(t, store, publisher)
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
	store := &mockAuthStore{
		insertUser: func(ctx context.Context, arg database.InsertUserParams) (database.User, error) {
			return database.User{ID: userID, Email: arg.Email, Username: arg.Username}, nil
		},
		insertRefreshToken: func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
			return database.RefreshToken{}, nil
		},
	}
	handler, priv := newTestAuthHandler(t, store, &mockPublisher{})

	rec := httptest.NewRecorder()
	req := newTestRequest(t, http.MethodPost, "/users", `{"email":"user@example.com","username":"spacecadet","password":"secret123"}`)

	handler.Signup(rec, req)

	var resp signupResponse
	decodeBody(t, rec, &resp)

	claims, err := auth.VerifyAccessToken(priv.Public(), resp.AccessToken)
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

func TestGetJWKS(t *testing.T) {
	router := newTestAuthRouter(t, &mockAuthStore{}, &mockPublisher{})
	rec := httptest.NewRecorder()
	req := newTestRequest(t, http.MethodGet, "/.well-known/jwks.json", "")

	router.ServeHTTP(rec, req)

	wantStatus(t, rec, http.StatusOK)

	var jwk auth.JWK
	decodeBody(t, rec, &jwk)
	if jwk.Kid != "test-key" {
		t.Errorf("kid = %q, want test-key", jwk.Kid)
	}
	if jwk.Kty != "OKP" {
		t.Errorf("kty = %q, want OKP", jwk.Kty)
	}
}
