package handler

import (
	"context"
	"crypto"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

type mockMeStore struct {
	getUserByID        func(ctx context.Context, id pgtype.UUID) (database.User, error)
	updateUserUsername func(ctx context.Context, arg database.UpdateUserUsernameParams) (database.User, error)
	deleteUserByID     func(ctx context.Context, id pgtype.UUID) error
}

func (m *mockMeStore) GetUserByID(ctx context.Context, id pgtype.UUID) (database.User, error) {
	if m.getUserByID != nil {
		return m.getUserByID(ctx, id)
	}
	return database.User{}, errors.New("unexpected GetUserByID call")
}

func (m *mockMeStore) UpdateUserUsername(ctx context.Context, arg database.UpdateUserUsernameParams) (database.User, error) {
	if m.updateUserUsername != nil {
		return m.updateUserUsername(ctx, arg)
	}
	return database.User{}, errors.New("unexpected UpdateUserUsername call")
}

func (m *mockMeStore) DeleteUserByID(ctx context.Context, id pgtype.UUID) error {
	if m.deleteUserByID != nil {
		return m.deleteUserByID(ctx, id)
	}
	return errors.New("unexpected DeleteUserByID call")
}

func newTestMeHandler(t *testing.T, store meStore, publisher EventPublisher) *MeHandler {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	// Use a static AuthHandshake with a no-op cache for unit tests —
	// auth middleware is tested separately in pkg/sharedhttp.
	cache := &noopJWKSCache{}
	authHandshake := sharedhttp.NewAuthHandshake(cache)
	return NewMeHandler(store, publisher, authHandshake, logger)
}

// noopJWKSCache is a JWKSCache that always returns "not found".
// Used in unit tests where auth middleware is bypassed by calling handlers directly.
type noopJWKSCache struct{}

func (c *noopJWKSCache) GetKey(ctx context.Context, kid string) (crypto.PublicKey, error) { return nil, auth.ErrUnknownKeyID }


func TestGetMe(t *testing.T) {
	userID := uuid.New()
	pgID := pgtype.UUID{Bytes: userID, Valid: true}
	createdAt := pgtype.Timestamptz{Time: time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC), Valid: true}
	updatedAt := pgtype.Timestamptz{Time: time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC), Valid: true}

	tests := []struct {
		name           string
		userID         string
		setupStore     func(m *mockMeStore)
		wantStatus     int
		wantErrorCode  string
		assertResponse func(t *testing.T, resp meResponse)
	}{
		{
			name:   "returns user identity",
			userID: userID.String(),
			setupStore: func(m *mockMeStore) {
				m.getUserByID = func(ctx context.Context, id pgtype.UUID) (database.User, error) {
					if id != pgID {
						t.Errorf("user_id = %v, want %v", id, pgID)
					}
					return database.User{
						ID:        pgID,
						Email:     "user@example.com",
						Username:  "spacecadet",
						CreatedAt: createdAt,
						UpdatedAt: updatedAt,
					}, nil
				}
			},
			wantStatus: http.StatusOK,
			assertResponse: func(t *testing.T, resp meResponse) {
				if resp.ID != userID.String() {
					t.Errorf("id = %q, want %q", resp.ID, userID.String())
				}
				if resp.Email != "user@example.com" {
					t.Errorf("email = %q, want user@example.com", resp.Email)
				}
				if resp.Username != "spacecadet" {
					t.Errorf("username = %q, want spacecadet", resp.Username)
				}
			},
		},
		{
			name:          "invalid uuid",
			userID:        "not-a-uuid",
			wantStatus:    http.StatusUnauthorized,
			wantErrorCode: "AUTH_INVALID_TOKEN",
		},
		{
			name:   "user not found",
			userID: userID.String(),
			setupStore: func(m *mockMeStore) {
				m.getUserByID = func(ctx context.Context, id pgtype.UUID) (database.User, error) {
					return database.User{}, pgx.ErrNoRows
				}
			},
			wantStatus:    http.StatusUnauthorized,
			wantErrorCode: "AUTH_INVALID_TOKEN",
		},
		{
			name:   "store error",
			userID: userID.String(),
			setupStore: func(m *mockMeStore) {
				m.getUserByID = func(ctx context.Context, id pgtype.UUID) (database.User, error) {
					return database.User{}, errors.New("database down")
				}
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &mockMeStore{}
			if tt.setupStore != nil {
				tt.setupStore(store)
			}

			handler := newTestMeHandler(t, store, &mockPublisher{})
			rec := httptest.NewRecorder()
			req := newTestRequest(t, http.MethodGet, "/users/me", "")

			handler.GetMe(rec, req, tt.userID)

			wantStatus(t, rec, tt.wantStatus)

			if tt.wantErrorCode != "" {
				wantErrorCode(t, rec, tt.wantErrorCode)
				return
			}

			if tt.assertResponse != nil {
				var resp meResponse
				decodeBody(t, rec, &resp)
				tt.assertResponse(t, resp)
			}
		})
	}
}

func TestUpdateMe(t *testing.T) {
	userID := uuid.New()
	pgID := pgtype.UUID{Bytes: userID, Valid: true}
	createdAt := pgtype.Timestamptz{Time: time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC), Valid: true}
	updatedAt := pgtype.Timestamptz{Time: time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC), Valid: true}

	tests := []struct {
		name           string
		userID         string
		body           string
		setupStore     func(m *mockMeStore)
		wantStatus     int
		wantFieldError map[string]string
		wantErrorCode  string
		assertResponse func(t *testing.T, resp meResponse)
	}{
		{
			name:   "updates username",
			userID: userID.String(),
			body:   `{"username":"new_name"}`,
			setupStore: func(m *mockMeStore) {
				m.updateUserUsername = func(ctx context.Context, arg database.UpdateUserUsernameParams) (database.User, error) {
					if arg.Username != "new_name" {
						t.Errorf("username = %q, want new_name", arg.Username)
					}
					if arg.ID != pgID {
						t.Errorf("user_id = %v, want %v", arg.ID, pgID)
					}
					return database.User{
						ID:        pgID,
						Email:     "user@example.com",
						Username:  "new_name",
						CreatedAt: createdAt,
						UpdatedAt: updatedAt,
					}, nil
				}
			},
			wantStatus: http.StatusOK,
			assertResponse: func(t *testing.T, resp meResponse) {
				if resp.Username != "new_name" {
					t.Errorf("username = %q, want new_name", resp.Username)
				}
			},
		},
		{
			name:          "invalid uuid",
			userID:        "not-a-uuid",
			body:          `{"username":"new_name"}`,
			wantStatus:    http.StatusUnauthorized,
			wantErrorCode: "AUTH_INVALID_TOKEN",
		},
		{
			name:           "missing username",
			userID:         userID.String(),
			body:           `{"username":""}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"username": "username is required"},
		},
		{
			name:           "invalid username too short",
			userID:         userID.String(),
			body:           `{"username":"ab"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"username": "username must be 3-30 characters and contain only letters, numbers, underscores, and hyphens"},
		},
		{
			name:           "invalid username bad chars",
			userID:         userID.String(),
			body:           `{"username":"bad name!"}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"username": "username must be 3-30 characters and contain only letters, numbers, underscores, and hyphens"},
		},
		{
			name:   "username already taken",
			userID: userID.String(),
			body:   `{"username":"taken_name"}`,
			setupStore: func(m *mockMeStore) {
				m.updateUserUsername = func(ctx context.Context, arg database.UpdateUserUsernameParams) (database.User, error) {
					return database.User{}, &pgconn.PgError{Code: "23505", ConstraintName: "users_username_lower_idx"}
				}
			},
			wantStatus:    http.StatusConflict,
			wantErrorCode: "USER_USERNAME_TAKEN",
		},
		{
			name:   "store error",
			userID: userID.String(),
			body:   `{"username":"new_name"}`,
			setupStore: func(m *mockMeStore) {
				m.updateUserUsername = func(ctx context.Context, arg database.UpdateUserUsernameParams) (database.User, error) {
					return database.User{}, errors.New("database down")
				}
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &mockMeStore{}
			if tt.setupStore != nil {
				tt.setupStore(store)
			}

			handler := newTestMeHandler(t, store, &mockPublisher{})
			rec := httptest.NewRecorder()
			req := newTestRequest(t, http.MethodPatch, "/users/me", tt.body)

			handler.UpdateMe(rec, req, tt.userID)

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

			if tt.assertResponse != nil {
				var resp meResponse
				decodeBody(t, rec, &resp)
				tt.assertResponse(t, resp)
			}
		})
	}
}

func TestDeleteMe(t *testing.T) {
	userID := uuid.New()
	pgID := pgtype.UUID{Bytes: userID, Valid: true}
	passwordHash, _ := auth.HashPassword("secret123")

	tests := []struct {
		name            string
		userID          string
		body            string
		setupStore      func(m *mockMeStore)
		setupPublisher  func(m *mockPublisher)
		wantStatus      int
		wantFieldError  map[string]string
		wantErrorCode   string
		assertPublished func(t *testing.T, calls []publishCall)
	}{
		{
			name:   "deletes user and publishes event",
			userID: userID.String(),
			body:   `{"password":"secret123"}`,
			setupStore: func(m *mockMeStore) {
				m.getUserByID = func(ctx context.Context, id pgtype.UUID) (database.User, error) {
					if id != pgID {
						t.Errorf("user_id = %v, want %v", id, pgID)
					}
					return database.User{
						ID:           pgID,
						Email:        "user@example.com",
						Username:     "spacecadet",
						PasswordHash: passwordHash,
					}, nil
				}
				m.deleteUserByID = func(ctx context.Context, id pgtype.UUID) error {
					if id != pgID {
						t.Errorf("delete user_id = %v, want %v", id, pgID)
					}
					return nil
				}
			},
			wantStatus: http.StatusNoContent,
			assertPublished: func(t *testing.T, calls []publishCall) {
				if len(calls) != 1 {
					t.Fatalf("published events = %d, want 1", len(calls))
				}
				if calls[0].EventType != "user.deleted" {
					t.Errorf("event type = %q, want user.deleted", calls[0].EventType)
				}
			},
		},
		{
			name:          "invalid uuid",
			userID:        "not-a-uuid",
			body:          `{"password":"secret123"}`,
			wantStatus:    http.StatusUnauthorized,
			wantErrorCode: "AUTH_INVALID_TOKEN",
		},
		{
			name:           "missing password",
			userID:         userID.String(),
			body:           `{"password":""}`,
			wantStatus:     http.StatusUnprocessableEntity,
			wantFieldError: map[string]string{"password": "password is required"},
		},
		{
			name:   "wrong password",
			userID: userID.String(),
			body:   `{"password":"wrongpassword"}`,
			setupStore: func(m *mockMeStore) {
				m.getUserByID = func(ctx context.Context, id pgtype.UUID) (database.User, error) {
					return database.User{
						ID:           pgID,
						Email:        "user@example.com",
						PasswordHash: passwordHash,
					}, nil
				}
			},
			wantStatus:    http.StatusUnauthorized,
			wantErrorCode: "USER_INVALID_CREDENTIALS",
		},
		{
			name:   "user not found",
			userID: userID.String(),
			body:   `{"password":"secret123"}`,
			setupStore: func(m *mockMeStore) {
				m.getUserByID = func(ctx context.Context, id pgtype.UUID) (database.User, error) {
					return database.User{}, pgx.ErrNoRows
				}
			},
			wantStatus:    http.StatusUnauthorized,
			wantErrorCode: "USER_INVALID_CREDENTIALS",
		},
		{
			name:   "get user store error",
			userID: userID.String(),
			body:   `{"password":"secret123"}`,
			setupStore: func(m *mockMeStore) {
				m.getUserByID = func(ctx context.Context, id pgtype.UUID) (database.User, error) {
					return database.User{}, errors.New("database down")
				}
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
		{
			name:   "delete store error",
			userID: userID.String(),
			body:   `{"password":"secret123"}`,
			setupStore: func(m *mockMeStore) {
				m.getUserByID = func(ctx context.Context, id pgtype.UUID) (database.User, error) {
					return database.User{
						ID:           pgID,
						PasswordHash: passwordHash,
					}, nil
				}
				m.deleteUserByID = func(ctx context.Context, id pgtype.UUID) error {
					return errors.New("database down")
				}
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
		{
			name:   "publisher failure returns 500",
			userID: userID.String(),
			body:   `{"password":"secret123"}`,
			setupStore: func(m *mockMeStore) {
				m.getUserByID = func(ctx context.Context, id pgtype.UUID) (database.User, error) {
					return database.User{
						ID:           pgID,
						PasswordHash: passwordHash,
					}, nil
				}
				m.deleteUserByID = func(ctx context.Context, id pgtype.UUID) error {
					return nil
				}
			},
			setupPublisher: func(m *mockPublisher) {
				m.err = errors.New("broker unreachable")
			},
			wantStatus:    http.StatusInternalServerError,
			wantErrorCode: "INTERNAL_ERROR",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &mockMeStore{}
			publisher := &mockPublisher{}
			if tt.setupStore != nil {
				tt.setupStore(store)
			}
			if tt.setupPublisher != nil {
				tt.setupPublisher(publisher)
			}

			handler := newTestMeHandler(t, store, publisher)
			rec := httptest.NewRecorder()
			req := newTestRequest(t, http.MethodDelete, "/users/me", tt.body)

			handler.DeleteMe(rec, req, tt.userID)

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

			if tt.assertPublished != nil {
				tt.assertPublished(t, publisher.published)
			}
		})
	}
}
