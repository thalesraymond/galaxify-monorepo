package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// meStore is the narrow database surface used by MeHandler.
type meStore interface {
	GetUserByID(ctx context.Context, id pgtype.UUID) (database.User, error)
	UpdateUserUsername(ctx context.Context, arg database.UpdateUserUsernameParams) (database.User, error)
	DeleteUserByID(ctx context.Context, id pgtype.UUID) error
}

// MeHandler handles auth-protected /users/me endpoints (GET, PATCH, DELETE).
type MeHandler struct {
	store     meStore
	publisher EventPublisher
	authMW    func(http.Handler) http.Handler
	logger    *slog.Logger
}

// NewMeHandler creates a MeHandler.
func NewMeHandler(
	store meStore,
	publisher EventPublisher,
	authMW func(http.Handler) http.Handler,
	logger *slog.Logger,
) *MeHandler {
	return &MeHandler{
		store:     store,
		publisher: publisher,
		authMW:    authMW,
		logger:    logger,
	}
}

// RegisterMeRoutes wires the auth-protected /users/me routes into the given mux.
func (h *MeHandler) RegisterMeRoutes(mux *http.ServeMux) {
	mux.Handle("GET /users/me", h.authMW(http.HandlerFunc(h.GetMe)))
	mux.Handle("PATCH /users/me", h.authMW(http.HandlerFunc(h.UpdateMe)))
	mux.Handle("DELETE /users/me", h.authMW(http.HandlerFunc(h.DeleteMe)))
}

// meResponse is the on-the-wire shape for GET and PATCH /users/me.
type meResponse = userResponse

// requireUserID extracts and parses the user ID from the request context.
// Returns the pgtype.UUID and true on success; on failure it writes an HTTP
// error response and returns (zero, false).
func requireUserID(w http.ResponseWriter, r *http.Request) (pgtype.UUID, bool) {
	userIDStr := sharedhttp.UserIDFromContext(r.Context())
	if userIDStr == "" {
		sharedhttp.WriteError(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "missing user identity")
		return pgtype.UUID{}, false
	}
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		sharedhttp.WriteError(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "invalid user identity")
		return pgtype.UUID{}, false
	}
	return pgtype.UUID{Bytes: userID, Valid: true}, true
}

// userToMeResponse maps a database.User to the on-the-wire meResponse shape.
func userToMeResponse(user database.User) meResponse {
	return meResponse{
		ID:        pgUUIDToString(user.ID),
		Email:     user.Email,
		Username:  user.Username,
		CreatedAt: user.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt: user.UpdatedAt.Time.Format(time.RFC3339),
	}
}

// GetMe returns the authenticated user's identity fields. Spec §3.4.
func (h *MeHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	pgID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	user, err := h.store.GetUserByID(r.Context(), pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			sharedhttp.WriteError(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "user not found")
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusOK, userToMeResponse(user))
}

type updateMeRequest struct {
	Username string `json:"username"`
}

// UpdateMe updates the authenticated user's username. Spec §3.5.
func (h *MeHandler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	pgID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req updateMeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"body": "invalid JSON body"})
		return
	}

	fieldErrors := validateUsername(req.Username)
	if len(fieldErrors) > 0 {
		sharedhttp.WriteValidationError(w, fieldErrors)
		return
	}

	user, err := h.store.UpdateUserUsername(r.Context(), database.UpdateUserUsernameParams{
		Username: req.Username,
		ID:       pgID,
	})
	if err != nil {
		h.handleUpdateUserError(w, r, err)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusOK, userToMeResponse(user))
}

type deleteMeRequest struct {
	Password string `json:"password"`
}

// DeleteMe permanently deletes the authenticated user's account. Spec §3.6.
func (h *MeHandler) DeleteMe(w http.ResponseWriter, r *http.Request) {
	pgID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req deleteMeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"body": "invalid JSON body"})
		return
	}

	if req.Password == "" {
		sharedhttp.WriteValidationError(w, map[string]string{"password": "password is required"})
		return
	}

	user, err := h.store.GetUserByID(r.Context(), pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			sharedhttp.WriteError(w, http.StatusUnauthorized, "USER_INVALID_CREDENTIALS", "Invalid credentials")
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	match, err := auth.ComparePasswordAndHash(req.Password, user.PasswordHash)
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}
	if !match {
		sharedhttp.WriteError(w, http.StatusUnauthorized, "USER_INVALID_CREDENTIALS", "Invalid credentials")
		return
	}

	if err := h.store.DeleteUserByID(r.Context(), pgID); err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	if err := h.publisher.Publish(r.Context(), "user.deleted", events.UserDeleted{
		Version: 1,
		UserID:  pgUUIDToString(pgID),
	}); err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// validateUsername checks the username against the Phase 1 rules: [a-zA-Z0-9_-], 3–30 chars.
func validateUsername(username string) map[string]string {
	fieldErrors := make(map[string]string)
	if username == "" {
		fieldErrors["username"] = "username is required"
	} else if !usernameRegex.MatchString(username) {
		fieldErrors["username"] = "username must be 3-30 characters and contain only letters, numbers, underscores, and hyphens"
	}
	return fieldErrors
}

// handleUpdateUserError maps database errors to the appropriate HTTP response
// for the PATCH /users/me endpoint.
func (h *MeHandler) handleUpdateUserError(w http.ResponseWriter, r *http.Request, err error) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		if pgErr.ConstraintName == "users_username_lower_idx" {
			sharedhttp.WriteError(w, http.StatusConflict, "USER_USERNAME_TAKEN", "Username already taken")
			return
		}
	}
	sharedhttp.WriteInternal(w, r, err, h.logger)
}
