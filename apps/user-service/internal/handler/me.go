package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/google/uuid"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// MeStore is the database surface used by MeHandler.
type MeStore interface {
	GetUserByID(ctx context.Context, id pgtype.UUID) (database.User, error)
	UpdateUserUsername(ctx context.Context, arg database.UpdateUserUsernameParams) (database.User, error)
	DeleteUserByID(ctx context.Context, id pgtype.UUID) error
	InsertOutbox(ctx context.Context, arg database.InsertOutboxParams) error
}

// MeHandler handles auth-protected /users/me endpoints (GET, PATCH, DELETE).
type MeHandler struct {
	store         MeStore
	txStarter     TxStarter
	storeFactory  func(tx pgx.Tx) MeStore
	authHandshake *sharedhttp.AuthHandshake
	logger        *slog.Logger
}

// NewMeHandler creates a MeHandler.
func NewMeHandler(
	store MeStore,
	txStarter TxStarter,
	storeFactory func(tx pgx.Tx) MeStore,
	authHandshake *sharedhttp.AuthHandshake,
	logger *slog.Logger,
) *MeHandler {
	return &MeHandler{
		store:         store,
		txStarter:     txStarter,
		storeFactory:  storeFactory,
		authHandshake: authHandshake,
		logger:        logger,
	}
}

// RegisterMeRoutes wires the auth-protected /users/me routes into the given mux.
func (h *MeHandler) RegisterMeRoutes(mux *http.ServeMux) {
	mux.Handle("GET /users/me", h.authHandshake.RequireAuth(h.GetMe))
	mux.Handle("PATCH /users/me", h.authHandshake.RequireAuth(h.UpdateMe))
	mux.Handle("DELETE /users/me", h.authHandshake.RequireAuth(h.DeleteMe))
}

// meResponse is the on-the-wire shape for GET and PATCH /users/me.
type meResponse = userResponse

// userToMeResponse maps a database.User to the on-the-wire meResponse shape.
func userToMeResponse(user database.User) meResponse {
	return meResponse{
		ID:        sharedhttp.UUIDToString(user.ID),
		Email:     user.Email,
		Username:  user.Username,
		CreatedAt: user.CreatedAt.Time.Format(time.RFC3339),
		UpdatedAt: user.UpdatedAt.Time.Format(time.RFC3339),
	}
}

// GetMe returns the authenticated user's identity fields. Spec §3.4.
func (h *MeHandler) GetMe(w http.ResponseWriter, r *http.Request, userID string) {
	pgID, err := sharedhttp.ParseUUID(userID)
	if err != nil {
		sharedhttp.WriteError(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "invalid user identity")
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
func (h *MeHandler) UpdateMe(w http.ResponseWriter, r *http.Request, userID string) {
	pgID, err := sharedhttp.ParseUUID(userID)
	if err != nil {
		sharedhttp.WriteError(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "invalid user identity")
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
func (h *MeHandler) DeleteMe(w http.ResponseWriter, r *http.Request, userID string) {
	pgID, err := sharedhttp.ParseUUID(userID)
	if err != nil {
		sharedhttp.WriteError(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "invalid user identity")
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

	tx, err := h.txStarter.Begin(r.Context())
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	store := h.storeFactory(tx)
	if err := store.DeleteUserByID(r.Context(), pgID); err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	eventPayload, err := json.Marshal(events.UserDeleted{
		Version: 1,
		UserID:  userID,
	})
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}
	requestID := sharedhttp.RequestIDFromContext(r.Context())
	if err := store.InsertOutbox(r.Context(), database.InsertOutboxParams{
		EventID:   pgtype.UUID{Bytes: uuid.New(), Valid: true},
		EventType: "user.deleted",
		Payload:   eventPayload,
		RequestID: pgtype.Text{String: requestID, Valid: requestID != ""},
	}); err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
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
