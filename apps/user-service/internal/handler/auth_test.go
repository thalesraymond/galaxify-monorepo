package handler

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
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

type mockQuerier struct {
	insertUser         func(ctx context.Context, arg database.InsertUserParams) (database.User, error)
	insertRefreshToken func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error)
}

func (m *mockQuerier) DeleteExpiredRefreshTokens(ctx context.Context) error {
	panic("unimplemented")
}

func (m *mockQuerier) DeleteOldProcessedEvents(ctx context.Context) (int64, error) {
	panic("unimplemented")
}

func (m *mockQuerier) DeleteRefreshTokensByFamilyID(ctx context.Context, familyID pgtype.UUID) error {
	panic("unimplemented")
}

func (m *mockQuerier) DeleteUserByID(ctx context.Context, id pgtype.UUID) error {
	panic("unimplemented")
}

func (m *mockQuerier) GetLatestSigningKey(ctx context.Context) (database.JwtKey, error) {
	panic("unimplemented")
}

func (m *mockQuerier) GetRefreshTokenByToken(ctx context.Context, token string) (database.RefreshToken, error) {
	panic("unimplemented")
}

func (m *mockQuerier) GetUserByEmail(ctx context.Context, email string) (database.User, error) {
	panic("unimplemented")
}

func (m *mockQuerier) GetUserByID(ctx context.Context, id pgtype.UUID) (database.User, error) {
	panic("unimplemented")
}

func (m *mockQuerier) InsertProcessedEvent(ctx context.Context, eventID pgtype.UUID) (int64, error) {
	panic("unimplemented")
}

func (m *mockQuerier) InsertRefreshToken(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
	if m.insertRefreshToken != nil {
		return m.insertRefreshToken(ctx, arg)
	}
	panic("unimplemented")
}

func (m *mockQuerier) InsertSigningKey(ctx context.Context, arg database.InsertSigningKeyParams) (database.JwtKey, error) {
	panic("unimplemented")
}

func (m *mockQuerier) InsertUser(ctx context.Context, arg database.InsertUserParams) (database.User, error) {
	if m.insertUser != nil {
		return m.insertUser(ctx, arg)
	}
	panic("unimplemented")
}

func (m *mockQuerier) MarkRefreshTokenUsed(ctx context.Context, id int64) error {
	panic("unimplemented")
}

func (m *mockQuerier) UpdateUserUsername(ctx context.Context, arg database.UpdateUserUsernameParams) (database.User, error) {
	panic("unimplemented")
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

func newTestAuthHandler(t *testing.T, q *mockQuerier, p *mockPublisher) (*AuthHandler, ed25519.PrivateKey) {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewAuthHandler("user-service", priv, "test-key", q, p, logger), priv
}

func TestSignupSuccess(t *testing.T) {
	userID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	querier := &mockQuerier{
		insertUser: func(ctx context.Context, arg database.InsertUserParams) (database.User, error) {
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
				CreatedAt:    pgtype.Timestamptz{Time: time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC), Valid: true},
				UpdatedAt:    pgtype.Timestamptz{Time: time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC), Valid: true},
			}, nil
		},
		insertRefreshToken: func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
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
		},
	}
	publisher := &mockPublisher{}
	handler, _ := newTestAuthHandler(t, querier, publisher)

	body := `{"email":"user@example.com","username":"spacecadet","password":"secret123"}`
	req := httptest.NewRequest(http.MethodPost, "/users", bytes.NewReader([]byte(body)))
	rec := httptest.NewRecorder()

	handler.Signup(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusCreated)
	}

	var resp signupResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
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

	if len(publisher.published) != 1 {
		t.Fatalf("published events = %d, want 1", len(publisher.published))
	}
	if publisher.published[0].EventType != "user.created" {
		t.Errorf("event type = %q, want user.created", publisher.published[0].EventType)
	}
}

func TestSignupValidationFailures(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		wantField   string
		wantMessage string
	}{
		{
			name:        "missing email",
			body:        `{"username":"spacecadet","password":"secret123"}`,
			wantField:   "email",
			wantMessage: "email is required",
		},
		{
			name:        "invalid email",
			body:        `{"email":"not-an-email","username":"spacecadet","password":"secret123"}`,
			wantField:   "email",
			wantMessage: "invalid email format",
		},
		{
			name:        "missing username",
			body:        `{"email":"user@example.com","password":"secret123"}`,
			wantField:   "username",
			wantMessage: "username is required",
		},
		{
			name:        "invalid username",
			body:        `{"email":"user@example.com","username":"ab","password":"secret123"}`,
			wantField:   "username",
			wantMessage: "username must be 3-30 characters and contain only letters, numbers, underscores, and hyphens",
		},
		{
			name:        "short password",
			body:        `{"email":"user@example.com","username":"spacecadet","password":"short"}`,
			wantField:   "password",
			wantMessage: "password must be at least 8 characters",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler, _ := newTestAuthHandler(t, &mockQuerier{}, &mockPublisher{})
			req := httptest.NewRequest(http.MethodPost, "/users", bytes.NewReader([]byte(tt.body)))
			rec := httptest.NewRecorder()

			handler.Signup(rec, req)

			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnprocessableEntity)
			}

			var resp errorResponse
			if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if resp.Error.Code != "VALIDATION_FAILED" {
				t.Errorf("error code = %q, want VALIDATION_FAILED", resp.Error.Code)
			}
			got, ok := resp.Error.Details.FieldErrors[tt.wantField]
			if !ok {
				t.Fatalf("missing field error for %q", tt.wantField)
			}
			if got != tt.wantMessage {
				t.Errorf("field error for %q = %q, want %q", tt.wantField, got, tt.wantMessage)
			}
		})
	}
}

func TestSignupEmailConflict(t *testing.T) {
	querier := &mockQuerier{
		insertUser: func(ctx context.Context, arg database.InsertUserParams) (database.User, error) {
			return database.User{}, &pgconn.PgError{Code: "23505", ConstraintName: "users_email_key"}
		},
	}
	handler, _ := newTestAuthHandler(t, querier, &mockPublisher{})

	body := `{"email":"user@example.com","username":"spacecadet","password":"secret123"}`
	req := httptest.NewRequest(http.MethodPost, "/users", bytes.NewReader([]byte(body)))
	rec := httptest.NewRecorder()

	handler.Signup(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusConflict)
	}

	var resp errorResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Error.Code != "USER_EMAIL_TAKEN" {
		t.Errorf("error code = %q, want USER_EMAIL_TAKEN", resp.Error.Code)
	}
}

func TestSignupUsernameConflict(t *testing.T) {
	querier := &mockQuerier{
		insertUser: func(ctx context.Context, arg database.InsertUserParams) (database.User, error) {
			return database.User{}, &pgconn.PgError{Code: "23505", ConstraintName: "users_username_lower_idx"}
		},
	}
	handler, _ := newTestAuthHandler(t, querier, &mockPublisher{})

	body := `{"email":"user@example.com","username":"spacecadet","password":"secret123"}`
	req := httptest.NewRequest(http.MethodPost, "/users", bytes.NewReader([]byte(body)))
	rec := httptest.NewRecorder()

	handler.Signup(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusConflict)
	}

	var resp errorResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Error.Code != "USER_USERNAME_TAKEN" {
		t.Errorf("error code = %q, want USER_USERNAME_TAKEN", resp.Error.Code)
	}
}

func TestSignupPublisherFailure(t *testing.T) {
	userID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	querier := &mockQuerier{
		insertUser: func(ctx context.Context, arg database.InsertUserParams) (database.User, error) {
			return database.User{ID: userID, Email: arg.Email, Username: arg.Username}, nil
		},
		insertRefreshToken: func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
			return database.RefreshToken{}, nil
		},
	}
	publisher := &mockPublisher{err: errors.New("broker unreachable")}
	handler, _ := newTestAuthHandler(t, querier, publisher)

	body := `{"email":"user@example.com","username":"spacecadet","password":"secret123"}`
	req := httptest.NewRequest(http.MethodPost, "/users", bytes.NewReader([]byte(body)))
	rec := httptest.NewRecorder()

	handler.Signup(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

func TestSignupAccessTokenIsValid(t *testing.T) {
	userID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	querier := &mockQuerier{
		insertUser: func(ctx context.Context, arg database.InsertUserParams) (database.User, error) {
			return database.User{ID: userID, Email: arg.Email, Username: arg.Username}, nil
		},
		insertRefreshToken: func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
			return database.RefreshToken{}, nil
		},
	}
	handler, priv := newTestAuthHandler(t, querier, &mockPublisher{})

	body := `{"email":"user@example.com","username":"spacecadet","password":"secret123"}`
	req := httptest.NewRequest(http.MethodPost, "/users", bytes.NewReader([]byte(body)))
	rec := httptest.NewRecorder()

	handler.Signup(rec, req)

	var resp signupResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

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

type errorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Details struct {
			FieldErrors map[string]string `json:"field_errors"`
		} `json:"details"`
	} `json:"error"`
}
