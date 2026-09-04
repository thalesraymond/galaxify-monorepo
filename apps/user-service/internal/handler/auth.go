package handler

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
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

type EventPublisher interface {
	Publish(ctx context.Context, eventType string, payload any) error
}

type AuthHandler struct {
	serviceName string
	privateKey  ed25519.PrivateKey
	kid         string
	querier     database.Querier
	publisher   EventPublisher
	logger      *slog.Logger
}

func NewAuthHandler(
	serviceName string,
	privateKey ed25519.PrivateKey,
	kid string,
	querier database.Querier,
	publisher EventPublisher,
	logger *slog.Logger,
) *AuthHandler {
	return &AuthHandler{
		serviceName: serviceName,
		privateKey:  privateKey,
		kid:         kid,
		querier:     querier,
		publisher:   publisher,
		logger:      logger,
	}
}

func (h *AuthHandler) RegisterAuthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /users", h.Signup)
	mux.HandleFunc("/.well-known/jwks.json", h.GetJWKS)
}

func (h *AuthHandler) GetJWKS(w http.ResponseWriter, r *http.Request) {
	jwk, err := auth.PublicKeyToJWK(h.privateKey.Public().(ed25519.PublicKey), h.kid)
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusOK, jwk)
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

type userResponse struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Username  string `json:"username"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type signupResponse struct {
	User         userResponse `json:"user"`
	AccessToken  string       `json:"access_token"`
	RefreshToken string       `json:"refresh_token"`
}

func (h *AuthHandler) Signup(w http.ResponseWriter, r *http.Request) {
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

	user, err := h.querier.InsertUser(r.Context(), database.InsertUserParams{
		Email:        input.Email,
		Username:     input.Username,
		PasswordHash: passwordHash,
	})
	if err != nil {
		h.handleInsertUserError(w, r, err)
		return
	}

	refreshToken, familyID, err := generateRefreshTokenAndFamily()
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	_, err = h.querier.InsertRefreshToken(r.Context(), database.InsertRefreshTokenParams{
		UserID:    user.ID,
		Token:     refreshToken,
		FamilyID:  pgtype.UUID{Bytes: familyID, Valid: true},
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(7 * 24 * time.Hour), Valid: true},
	})
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	accessToken, err := auth.IssueAccessToken(h.privateKey, h.kid, pgUUIDToString(user.ID), input.Email)
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	if err := h.publisher.Publish(r.Context(), "user.created", events.UserCreated{
		Version:  1,
		UserID:   pgUUIDToString(user.ID),
		Email:    input.Email,
		Username: input.Username,
	}); err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusCreated, signupResponse{
		User: userResponse{
			ID:        pgUUIDToString(user.ID),
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

func generateRefreshTokenAndFamily() (token string, familyID uuid.UUID, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", uuid.UUID{}, err
	}
	token = base64.RawURLEncoding.EncodeToString(b)

	familyID = uuid.New()
	return token, familyID, nil
}

func (h *AuthHandler) handleInsertUserError(w http.ResponseWriter, r *http.Request, err error) {
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

func pgUUIDToString(u pgtype.UUID) string {
	return uuid.UUID(u.Bytes).String()
}
