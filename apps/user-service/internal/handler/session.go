package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/session"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// sessionStore is the narrow database surface used by SessionHandler's login flow.
type sessionStore interface {
	GetUserByEmail(ctx context.Context, email string) (database.User, error)
}

// SessionHandler handles authentication sessions (login and refresh).
type SessionHandler struct {
	store       sessionStore
	manager     session.Manager
	tokenIssuer *TokenIssuer
	logger      *slog.Logger
}

// NewSessionHandler creates a SessionHandler.
func NewSessionHandler(
	store sessionStore,
	manager session.Manager,
	tokenIssuer *TokenIssuer,
	logger *slog.Logger,
) *SessionHandler {
	return &SessionHandler{
		store:       store,
		manager:     manager,
		tokenIssuer: tokenIssuer,
		logger:      logger,
	}
}

// RegisterRoutes wires the session routes into the given mux.
func (h *SessionHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /auth/login", h.Login)
	mux.HandleFunc("POST /auth/refresh", h.Refresh)
	mux.HandleFunc("POST /auth/logout", h.Logout)
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginInput struct {
	Email    string
	Password string
}

// Login authenticates a user by email and password and issues a new session.
func (h *SessionHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"body": "invalid JSON body"})
		return
	}

	input, fieldErrors := validateLoginRequest(req)
	if len(fieldErrors) > 0 {
		sharedhttp.WriteValidationError(w, fieldErrors)
		return
	}

	user, err := h.store.GetUserByEmail(r.Context(), input.Email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			sharedhttp.WriteError(w, http.StatusUnauthorized, "USER_INVALID_CREDENTIALS", "Invalid email or password")
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	match, err := auth.ComparePasswordAndHash(input.Password, user.PasswordHash)
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}
	if !match {
		sharedhttp.WriteError(w, http.StatusUnauthorized, "USER_INVALID_CREDENTIALS", "Invalid email or password")
		return
	}

	accessToken, refreshToken, err := h.tokenIssuer.IssueSession(r.Context(), user.ID, user.Email)
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusOK, authSessionResponse{
		User: userResponse{
			ID:        sharedhttp.UUIDToString(user.ID),
			Email:     user.Email,
			Username:  user.Username,
			CreatedAt: user.CreatedAt.Time.Format(time.RFC3339),
			UpdatedAt: user.UpdatedAt.Time.Format(time.RFC3339),
		},
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
	})
}

func validateLoginRequest(req loginRequest) (loginInput, map[string]string) {
	input := loginInput{
		Email:    strings.ToLower(strings.TrimSpace(req.Email)),
		Password: req.Password,
	}
	fieldErrors := make(map[string]string)

	if input.Email == "" {
		fieldErrors["email"] = "email is required"
	}

	if input.Password == "" {
		fieldErrors["password"] = "password is required"
	}

	return input, fieldErrors
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// Refresh implements POST /auth/refresh with family-based token rotation.
// Spec §3.3.
func (h *SessionHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"body": "invalid JSON body"})
		return
	}

	if req.RefreshToken == "" {
		sharedhttp.WriteValidationError(w, map[string]string{"refresh_token": "refresh_token is required"})
		return
	}

	rotation, err := h.manager.Rotate(r.Context(), req.RefreshToken)
	if err != nil {
		if errors.Is(err, session.ErrInvalidRefreshToken) {
			sharedhttp.WriteError(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "Invalid or expired refresh token")
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	accessToken, err := auth.IssueAccessToken(h.tokenIssuer.privateKey, h.tokenIssuer.kid, sharedhttp.UUIDToString(rotation.UserID), rotation.Email)
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusOK, refreshResponse{
		AccessToken:  accessToken,
		RefreshToken: rotation.RefreshToken,
	})
}

// Logout revokes only the presented refresh-token family. It intentionally
// requires no access token and is idempotent to avoid existence disclosure.
func (h *SessionHandler) Logout(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"body": "invalid JSON body"})
		return
	}
	if req.RefreshToken == "" {
		sharedhttp.WriteValidationError(w, map[string]string{"refresh_token": "refresh_token is required"})
		return
	}
	if err := h.manager.Logout(r.Context(), req.RefreshToken); err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
