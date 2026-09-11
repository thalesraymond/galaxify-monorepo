package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
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

var (
	emailRegex    = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]{3,30}$`)
)

const userCreatedEventType = "user.created"

// RegistrationStore is the narrow database surface used by RegistrationHandler.
type RegistrationStore interface {
	InsertUser(ctx context.Context, arg database.InsertUserParams) (database.User, error)
	InsertOutbox(ctx context.Context, arg database.InsertOutboxParams) error
}

// RegistrationHandler handles user registration.
type RegistrationHandler struct {
	txStarter    events.TxStarter
	storeFactory func(tx pgx.Tx) RegistrationStore
	tokenIssuer  *TokenIssuer
	logger       *slog.Logger
}

// NewRegistrationHandler creates a RegistrationHandler.
func NewRegistrationHandler(
	txStarter events.TxStarter,
	storeFactory func(tx pgx.Tx) RegistrationStore,
	tokenIssuer *TokenIssuer,
	logger *slog.Logger,
) *RegistrationHandler {
	return &RegistrationHandler{
		txStarter:    txStarter,
		storeFactory: storeFactory,
		tokenIssuer:  tokenIssuer,
		logger:       logger,
	}
}

// RegisterRoutes wires the registration routes into the given mux.
func (h *RegistrationHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /users", h.Signup)
}

type signupRequest struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type signupInput struct {
	Email    string
	Username string
	Password string
}

// Signup creates a new user account and issues the first session.
func (h *RegistrationHandler) Signup(w http.ResponseWriter, r *http.Request) {
	var req signupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"body": "invalid JSON body"})
		return
	}

	input, fieldErrors := validateSignupRequest(req)
	if len(fieldErrors) > 0 {
		sharedhttp.WriteValidationError(w, fieldErrors)
		return
	}

	passwordHash, err := auth.HashPassword(input.Password)
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	tx, err := h.txStarter.Begin(r.Context())
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	store := h.storeFactory(tx)
	user, err := store.InsertUser(r.Context(), database.InsertUserParams{
		ID:           pgtype.UUID{Bytes: uuid.New(), Valid: true},
		Email:        input.Email,
		Username:     input.Username,
		PasswordHash: passwordHash,
	})
	if err != nil {
		h.handleInsertUserError(w, r, err)
		return
	}

	eventPayload, err := json.Marshal(events.UserCreated{
		Version:  1,
		UserID:   sharedhttp.UUIDToString(user.ID),
		Email:    input.Email,
		Username: input.Username,
	})
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}
	requestID := sharedhttp.RequestIDFromContext(r.Context())
	if err := store.InsertOutbox(r.Context(), database.InsertOutboxParams{
		EventID:   pgtype.UUID{Bytes: uuid.New(), Valid: true},
		EventType: userCreatedEventType,
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

	accessToken, refreshToken, err := h.tokenIssuer.IssueSession(r.Context(), user.ID, input.Email)
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusCreated, authSessionResponse{
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

func validateSignupRequest(req signupRequest) (signupInput, map[string]string) {
	input := signupInput{
		Email:    strings.ToLower(strings.TrimSpace(req.Email)),
		Username: req.Username,
		Password: req.Password,
	}
	fieldErrors := make(map[string]string)

	if input.Email == "" {
		fieldErrors["email"] = "email is required"
	} else if !emailRegex.MatchString(input.Email) {
		fieldErrors["email"] = "invalid email format"
	}

	if input.Username == "" {
		fieldErrors["username"] = "username is required"
	} else if !usernameRegex.MatchString(input.Username) {
		fieldErrors["username"] = "username must be 3-30 characters and contain only letters, numbers, underscores, and hyphens"
	}

	if input.Password == "" {
		fieldErrors["password"] = "password is required"
	} else if len(input.Password) < 8 {
		fieldErrors["password"] = "password must be at least 8 characters"
	}

	return input, fieldErrors
}

func (h *RegistrationHandler) handleInsertUserError(w http.ResponseWriter, r *http.Request, err error) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		switch pgErr.ConstraintName {
		case "users_email_key":
			sharedhttp.WriteError(w, http.StatusConflict, "USER_EMAIL_TAKEN", "Email already registered")
			return
		case "users_username_lower_idx":
			sharedhttp.WriteError(w, http.StatusConflict, "USER_USERNAME_TAKEN", "Username already taken")
			return
		}
	}
	sharedhttp.WriteInternal(w, r, err, h.logger)
}
