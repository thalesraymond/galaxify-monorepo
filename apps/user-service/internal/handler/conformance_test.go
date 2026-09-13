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
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/httpcontract"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// userConformanceHarness wires the real user-service route table against
// in-memory stores so kin-openapi can validate the wire shapes end to end.
type userConformanceHarness struct {
	mux    *http.ServeMux
	router http.Handler
	priv   ed25519.PrivateKey
	kid    string

	registration *mockRegistrationStore
	session      *mockSessionStore
	me           *mockMeStore
	refreshToken *mockRefreshTokenStore
}

func (h *userConformanceHarness) token(t *testing.T, userID string) string {
	t.Helper()
	token, err := auth.IssueAccessToken(h.priv, h.kid, userID, "user@example.com")
	if err != nil {
		t.Fatalf("issue access token: %v", err)
	}
	return token
}

func newUserConformance(t *testing.T) *userConformanceHarness {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	const kid = "user-conformance-kid"
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	passwordHash, err := auth.HashPassword("secret123")
	if err != nil {
		t.Fatal(err)
	}
	createdAt := pgtype.Timestamptz{Time: time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC), Valid: true}
	userID := uuid.New()
	pgID := pgtype.UUID{Bytes: userID, Valid: true}
	user := database.User{
		ID: pgID, Email: "user@example.com", Username: "spacecadet",
		PasswordHash: passwordHash, CreatedAt: createdAt, UpdatedAt: createdAt,
	}
	familyID := pgtype.UUID{Bytes: uuid.New(), Valid: true}

	registration := &mockRegistrationStore{
		insertUser: func(_ context.Context, arg database.InsertUserParams) (database.User, error) {
			u := user
			u.ID = arg.ID
			u.Email = arg.Email
			u.Username = arg.Username
			u.PasswordHash = arg.PasswordHash
			return u, nil
		},
		insertOutbox: func(context.Context, database.InsertOutboxParams) error { return nil },
	}
	session := &mockSessionStore{
		getUserByEmail: func(context.Context, string) (database.User, error) { return user, nil },
		getRefreshTokenByToken: func(context.Context, string) (database.RefreshToken, error) {
			return database.RefreshToken{
				ID: 1, UserID: pgID, Token: "valid-token", FamilyID: familyID, Used: false,
				ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
			}, nil
		},
		markRefreshTokenUsed:        func(context.Context, int64) error { return nil },
		deleteRefreshTokensByFamily: func(context.Context, pgtype.UUID) error { return nil },
		insertRefreshToken: func(context.Context, database.InsertRefreshTokenParams) (database.RefreshToken, error) {
			return database.RefreshToken{}, nil
		},
		getUserByID: func(context.Context, pgtype.UUID) (database.User, error) { return user, nil },
	}
	me := &mockMeStore{
		getUserByID: func(context.Context, pgtype.UUID) (database.User, error) { return user, nil },
		updateUserUsername: func(_ context.Context, arg database.UpdateUserUsernameParams) (database.User, error) {
			u := user
			u.Username = arg.Username
			return u, nil
		},
		deleteUserByID: func(context.Context, pgtype.UUID) error { return nil },
		insertOutbox:   func(context.Context, database.InsertOutboxParams) error { return nil },
	}
	refreshToken := &mockRefreshTokenStore{
		insertRefreshToken: func(context.Context, database.InsertRefreshTokenParams) (database.RefreshToken, error) {
			return database.RefreshToken{}, nil
		},
	}

	tokenIssuer := NewTokenIssuer(priv, kid, refreshToken)
	authHandshake := sharedhttp.NewAuthHandshake(auth.NewStaticJWKSCache(kid, pub))
	starter := &fakeTxStarter{}

	mux := http.NewServeMux()
	NewUserHealthHandler("user-service").RegisterHealthRoutes(mux)
	NewRegistrationHandler(starter, func(pgx.Tx) RegistrationStore { return registration }, tokenIssuer, logger).RegisterRoutes(mux)
	NewSessionHandler(session, tokenIssuer, logger).RegisterRoutes(mux)
	NewJWKSHandler(priv, kid, logger).RegisterRoutes(mux)
	NewMeHandler(me, starter, func(pgx.Tx) MeStore { return me }, authHandshake, logger).RegisterMeRoutes(mux)

	return &userConformanceHarness{
		mux: mux, router: sharedhttp.RequestIDMiddleware(mux), priv: priv, kid: kid,
		registration: registration, session: session, me: me, refreshToken: refreshToken,
	}
}

func TestOpenAPIConformance(t *testing.T) {
	doc := httpcontract.LoadSpec(t, "user")
	registered := []httpcontract.Operation{
		{Method: http.MethodGet, Path: "/health"},
		{Method: http.MethodPost, Path: "/users"},
		{Method: http.MethodPost, Path: "/auth/login"},
		{Method: http.MethodPost, Path: "/auth/refresh"},
		{Method: http.MethodGet, Path: "/.well-known/jwks.json"},
		{Method: http.MethodGet, Path: "/users/me"},
		{Method: http.MethodPatch, Path: "/users/me"},
		{Method: http.MethodDelete, Path: "/users/me"},
	}

	coverage := newUserConformance(t)
	httpcontract.AssertRoutePatterns(t, coverage.mux, registered)
	httpcontract.AssertRouteCoverage(t, doc, registered)

	subject := uuid.New().String()

	tests := []struct {
		name         string
		method       string
		target       string
		body         string
		noAuth       bool
		rawAuth      string
		configure    func(*userConformanceHarness)
		wantStatus   int
		responseOnly bool
	}{
		{name: "health", method: http.MethodGet, target: "/health", noAuth: true, wantStatus: http.StatusOK},
		{
			name: "signup", method: http.MethodPost, target: "/users",
			body:       `{"email":"user@example.com","username":"spacecadet","password":"secret123"}`,
			wantStatus: http.StatusCreated,
		},
		{
			name: "signup email taken", method: http.MethodPost, target: "/users",
			body: `{"email":"user@example.com","username":"spacecadet","password":"secret123"}`,
			configure: func(h *userConformanceHarness) {
				h.registration.insertUser = func(context.Context, database.InsertUserParams) (database.User, error) {
					return database.User{}, &pgconn.PgError{Code: "23505", ConstraintName: "users_email_key"}
				}
			},
			wantStatus: http.StatusConflict,
		},
		{
			name: "signup validation error", method: http.MethodPost, target: "/users",
			body:       `{"username":"spacecadet","password":"secret123"}`,
			wantStatus: http.StatusUnprocessableEntity, responseOnly: true,
		},
		{
			name: "signup internal error", method: http.MethodPost, target: "/users",
			body: `{"email":"user@example.com","username":"spacecadet","password":"secret123"}`,
			configure: func(h *userConformanceHarness) {
				h.registration.insertUser = func(context.Context, database.InsertUserParams) (database.User, error) {
					return database.User{}, errors.New("db down")
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "login", method: http.MethodPost, target: "/auth/login",
			body:       `{"email":"user@example.com","password":"secret123"}`,
			wantStatus: http.StatusOK,
		},
		{
			name: "login invalid credentials", method: http.MethodPost, target: "/auth/login",
			body: `{"email":"user@example.com","password":"secret123"}`,
			configure: func(h *userConformanceHarness) {
				h.session.getUserByEmail = func(context.Context, string) (database.User, error) {
					return database.User{}, pgx.ErrNoRows
				}
			},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "login validation error", method: http.MethodPost, target: "/auth/login",
			body:       `{"email":"user@example.com"}`,
			wantStatus: http.StatusUnprocessableEntity, responseOnly: true,
		},
		{
			name: "login internal error", method: http.MethodPost, target: "/auth/login",
			body: `{"email":"user@example.com","password":"secret123"}`,
			configure: func(h *userConformanceHarness) {
				h.session.getUserByEmail = func(context.Context, string) (database.User, error) {
					return database.User{}, errors.New("db down")
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "refresh", method: http.MethodPost, target: "/auth/refresh",
			body:       `{"refresh_token":"valid-token"}`,
			wantStatus: http.StatusOK,
		},
		{
			name: "refresh invalid token", method: http.MethodPost, target: "/auth/refresh",
			body: `{"refresh_token":"valid-token"}`,
			configure: func(h *userConformanceHarness) {
				h.session.getRefreshTokenByToken = func(context.Context, string) (database.RefreshToken, error) {
					return database.RefreshToken{}, pgx.ErrNoRows
				}
			},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "refresh validation error", method: http.MethodPost, target: "/auth/refresh",
			body:       `{}`,
			wantStatus: http.StatusUnprocessableEntity, responseOnly: true,
		},
		{
			name: "refresh internal error", method: http.MethodPost, target: "/auth/refresh",
			body: `{"refresh_token":"valid-token"}`,
			configure: func(h *userConformanceHarness) {
				h.session.getUserByID = func(context.Context, pgtype.UUID) (database.User, error) {
					return database.User{}, errors.New("db down")
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
		{name: "jwks", method: http.MethodGet, target: "/.well-known/jwks.json", noAuth: true, wantStatus: http.StatusOK},
		{name: "get me", method: http.MethodGet, target: "/users/me", wantStatus: http.StatusOK},
		{name: "get me missing auth", method: http.MethodGet, target: "/users/me", noAuth: true, wantStatus: http.StatusUnauthorized},
		{name: "get me invalid token", method: http.MethodGet, target: "/users/me", rawAuth: "Bearer not-a-jwt", wantStatus: http.StatusUnauthorized},
		{
			name: "get me internal error", method: http.MethodGet, target: "/users/me",
			configure: func(h *userConformanceHarness) {
				h.me.getUserByID = func(context.Context, pgtype.UUID) (database.User, error) {
					return database.User{}, errors.New("db down")
				}
			},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "update me", method: http.MethodPatch, target: "/users/me",
			body:       `{"username":"new_name"}`,
			wantStatus: http.StatusOK,
		},
		{
			name: "update me username taken", method: http.MethodPatch, target: "/users/me",
			body: `{"username":"taken_name"}`,
			configure: func(h *userConformanceHarness) {
				h.me.updateUserUsername = func(context.Context, database.UpdateUserUsernameParams) (database.User, error) {
					return database.User{}, &pgconn.PgError{Code: "23505", ConstraintName: "users_username_lower_idx"}
				}
			},
			wantStatus: http.StatusConflict,
		},
		{
			name: "update me validation error", method: http.MethodPatch, target: "/users/me",
			body:       `{"username":"ab"}`,
			wantStatus: http.StatusUnprocessableEntity, responseOnly: true,
		},
		{name: "update me missing auth", method: http.MethodPatch, target: "/users/me", body: `{"username":"new_name"}`, noAuth: true, wantStatus: http.StatusUnauthorized},
		{
			name: "delete me", method: http.MethodDelete, target: "/users/me",
			body:       `{"password":"secret123"}`,
			wantStatus: http.StatusNoContent,
		},
		{
			name: "delete me wrong password", method: http.MethodDelete, target: "/users/me",
			body:       `{"password":"wrongpassword"}`,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "delete me validation error", method: http.MethodDelete, target: "/users/me",
			body:       `{}`,
			wantStatus: http.StatusUnprocessableEntity, responseOnly: true,
		},
		{
			name: "delete me internal error", method: http.MethodDelete, target: "/users/me",
			body: `{"password":"secret123"}`,
			configure: func(h *userConformanceHarness) {
				h.me.deleteUserByID = func(context.Context, pgtype.UUID) error { return errors.New("db down") }
			},
			wantStatus: http.StatusInternalServerError,
		},
		{name: "delete me missing auth", method: http.MethodDelete, target: "/users/me", body: `{"password":"secret123"}`, noAuth: true, wantStatus: http.StatusUnauthorized},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			harness := newUserConformance(t)
			if tc.configure != nil {
				tc.configure(harness)
			}

			buildRequest := func() *http.Request {
				var body io.Reader
				if tc.body != "" {
					body = strings.NewReader(tc.body)
				}
				req := httptest.NewRequest(tc.method, tc.target, body)
				req.Header.Set("Content-Type", "application/json")
				switch {
				case tc.rawAuth != "":
					req.Header.Set("Authorization", tc.rawAuth)
				case !tc.noAuth:
					req.Header.Set("Authorization", "Bearer "+harness.token(t, subject))
				}
				return req
			}

			httpcontract.RunExchange(t, doc, harness.router, buildRequest, httpcontract.ExchangeOptions{
				ValidateRequest: !tc.responseOnly,
				WantStatus:      tc.wantStatus,
			})
		})
	}
}
