package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// dailyStore is the narrow database surface used by DailyHandler.
type dailyStore interface {
	CreateDaily(ctx context.Context, arg database.CreateDailyParams) (database.Daily, error)
	ListDailies(ctx context.Context, userID pgtype.UUID) ([]database.Daily, error)
	GetDaily(ctx context.Context, arg database.GetDailyParams) (database.Daily, error)
	UpdateDaily(ctx context.Context, arg database.UpdateDailyParams) (database.Daily, error)
	DeleteDaily(ctx context.Context, arg database.DeleteDailyParams) (int64, error)
	MarkDailyComplete(ctx context.Context, arg database.MarkDailyCompleteParams) (database.Daily, error)
	GetDifficultyReward(ctx context.Context, difficulty string) (database.DifficultyReward, error)
}

// EventPublisher is the narrow surface used by handlers to emit domain events.
type EventPublisher interface {
	Publish(ctx context.Context, eventType string, payload any, opts ...events.PublishOption) error
}

// DailyHandler handles auth-protected CRUD endpoints for /dailies.
type DailyHandler struct {
	store         dailyStore
	publisher     EventPublisher
	authHandshake *sharedhttp.AuthHandshake
	logger        *slog.Logger
}

// NewDailyHandler creates a DailyHandler.
func NewDailyHandler(store dailyStore, publisher EventPublisher, authHandshake *sharedhttp.AuthHandshake, logger *slog.Logger) *DailyHandler {
	return &DailyHandler{
		store:         store,
		publisher:     publisher,
		authHandshake: authHandshake,
		logger:        logger,
	}
}

// RegisterDailyRoutes wires the auth-protected /dailies routes into the given mux.
func (h *DailyHandler) RegisterDailyRoutes(mux *http.ServeMux) {
	mux.Handle("POST /dailies", h.authHandshake.RequireAuth(h.CreateDaily))
	mux.Handle("GET /dailies", h.authHandshake.RequireAuth(h.ListDailies))
	mux.Handle("GET /dailies/{id}", h.authHandshake.RequireAuth(h.GetDaily))
	mux.Handle("PATCH /dailies/{id}", h.authHandshake.RequireAuth(h.UpdateDaily))
	mux.Handle("DELETE /dailies/{id}", h.authHandshake.RequireAuth(h.DeleteDaily))
	mux.Handle("POST /dailies/{id}/complete", h.authHandshake.RequireAuth(h.CompleteDaily))
}

// dailyResponse is the on-the-wire shape for a daily resource.
type dailyResponse struct {
	ID          string `json:"id"`
	UserID      string `json:"user_id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Difficulty  string `json:"difficulty"`
	DueDate     string `json:"due_date"`
	Status      string `json:"status"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

type createDailyRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Difficulty  string `json:"difficulty"`
	DueDate     string `json:"due_date"`
}

type updateDailyRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Difficulty  string `json:"difficulty"`
	DueDate     string `json:"due_date"`
}

var validDifficulties = map[string]struct{}{
	"EASY":   {},
	"MEDIUM": {},
	"HARD":   {},
}

func (h *DailyHandler) requireUserID(w http.ResponseWriter, userID string) (pgtype.UUID, bool) {
	id, err := sharedhttp.ParseUUID(userID)
	if err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"user_id": "invalid UUID"})
		return pgtype.UUID{}, false
	}
	return id, true
}

// CreateDaily creates a new daily for the authenticated user.
func (h *DailyHandler) CreateDaily(w http.ResponseWriter, r *http.Request, userID string) {
	pgUserID, ok := h.requireUserID(w, userID)
	if !ok {
		return
	}

	var req createDailyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"body": "invalid JSON body"})
		return
	}

	fieldErrors, dueDate := validateCreateDailyRequest(req)
	if len(fieldErrors) > 0 {
		sharedhttp.WriteValidationError(w, fieldErrors)
		return
	}

	daily, err := h.store.CreateDaily(r.Context(), database.CreateDailyParams{
		UserID:      pgUserID,
		Title:       req.Title,
		Description: req.Description,
		Difficulty:  req.Difficulty,
		DueDate:     pgtype.Timestamptz{Time: dueDate, Valid: true},
	})
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusCreated, dailyToResponse(daily))
}

// ListDailies returns all dailies for the authenticated user.
func (h *DailyHandler) ListDailies(w http.ResponseWriter, r *http.Request, userID string) {
	pgUserID, ok := h.requireUserID(w, userID)
	if !ok {
		return
	}

	dailies, err := h.store.ListDailies(r.Context(), pgUserID)
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	resp := make([]dailyResponse, len(dailies))
	for i, daily := range dailies {
		resp[i] = dailyToResponse(daily)
	}

	sharedhttp.WriteJSON(w, http.StatusOK, resp)
}

// GetDaily returns a single daily owned by the authenticated user.
func (h *DailyHandler) GetDaily(w http.ResponseWriter, r *http.Request, userID string) {
	pgUserID, ok := h.requireUserID(w, userID)
	if !ok {
		return
	}

	pgDailyID, err := sharedhttp.ParseUUID(r.PathValue("id"))
	if err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"id": "invalid UUID"})
		return
	}

	daily, err := h.store.GetDaily(r.Context(), database.GetDailyParams{
		ID:     pgDailyID,
		UserID: pgUserID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			sharedhttp.WriteError(w, http.StatusNotFound, "DAILY_NOT_FOUND", "Daily not found")
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusOK, dailyToResponse(daily))
}

// UpdateDaily edits a daily if it is still pending.
func (h *DailyHandler) UpdateDaily(w http.ResponseWriter, r *http.Request, userID string) {
	pgUserID, ok := h.requireUserID(w, userID)
	if !ok {
		return
	}

	pgDailyID, err := sharedhttp.ParseUUID(r.PathValue("id"))
	if err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"id": "invalid UUID"})
		return
	}

	var req updateDailyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"body": "invalid JSON body"})
		return
	}

	fieldErrors, dueDate := validateUpdateDailyRequest(req)
	if len(fieldErrors) > 0 {
		sharedhttp.WriteValidationError(w, fieldErrors)
		return
	}

	existing, err := h.store.GetDaily(r.Context(), database.GetDailyParams{
		ID:     pgDailyID,
		UserID: pgUserID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			sharedhttp.WriteError(w, http.StatusNotFound, "DAILY_NOT_FOUND", "Daily not found")
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	if existing.Status != "PENDING" {
		sharedhttp.WriteError(w, http.StatusConflict, "DAILY_NOT_EDITABLE", "Daily can only be edited while pending")
		return
	}

	params := database.UpdateDailyParams{
		ID:     pgDailyID,
		UserID: pgUserID,
	}
	if req.Title != "" {
		params.Title = pgtype.Text{String: req.Title, Valid: true}
	}
	if req.Description != "" {
		params.Description = pgtype.Text{String: req.Description, Valid: true}
	}
	if req.Difficulty != "" {
		params.Difficulty = pgtype.Text{String: req.Difficulty, Valid: true}
	}
	if dueDate != nil {
		params.DueDate = pgtype.Timestamptz{Time: *dueDate, Valid: true}
	}

	daily, err := h.store.UpdateDaily(r.Context(), params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			sharedhttp.WriteError(w, http.StatusConflict, "DAILY_NOT_EDITABLE", "Daily can only be edited while pending")
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusOK, dailyToResponse(daily))
}

// DeleteDaily removes a daily if it is still pending.
func (h *DailyHandler) DeleteDaily(w http.ResponseWriter, r *http.Request, userID string) {
	pgUserID, ok := h.requireUserID(w, userID)
	if !ok {
		return
	}

	pgDailyID, err := sharedhttp.ParseUUID(r.PathValue("id"))
	if err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"id": "invalid UUID"})
		return
	}

	existing, err := h.store.GetDaily(r.Context(), database.GetDailyParams{
		ID:     pgDailyID,
		UserID: pgUserID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			sharedhttp.WriteError(w, http.StatusNotFound, "DAILY_NOT_FOUND", "Daily not found")
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	if existing.Status != "PENDING" {
		sharedhttp.WriteError(w, http.StatusConflict, "DAILY_NOT_EDITABLE", "Daily can only be deleted while pending")
		return
	}

	rowsAffected, err := h.store.DeleteDaily(r.Context(), database.DeleteDailyParams{
		ID:     pgDailyID,
		UserID: pgUserID,
	})
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}
	if rowsAffected == 0 {
		sharedhttp.WriteError(w, http.StatusConflict, "DAILY_NOT_EDITABLE", "Daily can only be deleted while pending")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// CompleteDaily marks a pending daily as COMPLETED and publishes a daily.completed event.
func (h *DailyHandler) CompleteDaily(w http.ResponseWriter, r *http.Request, userID string) {
	pgUserID, ok := h.requireUserID(w, userID)
	if !ok {
		return
	}

	pgDailyID, err := sharedhttp.ParseUUID(r.PathValue("id"))
	if err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"id": "invalid UUID"})
		return
	}

	existing, err := h.store.GetDaily(r.Context(), database.GetDailyParams{
		ID:     pgDailyID,
		UserID: pgUserID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			sharedhttp.WriteError(w, http.StatusNotFound, "DAILY_NOT_FOUND", "Daily not found")
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	if existing.Status != "PENDING" {
		sharedhttp.WriteError(w, http.StatusConflict, "DAILY_ALREADY_COMPLETED", "Daily is not pending")
		return
	}

	daily, err := h.store.MarkDailyComplete(r.Context(), database.MarkDailyCompleteParams{
		ID:     pgDailyID,
		UserID: pgUserID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			sharedhttp.WriteError(w, http.StatusConflict, "DAILY_ALREADY_COMPLETED", "Daily can only be completed while pending")
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	reward, err := h.store.GetDifficultyReward(r.Context(), daily.Difficulty)
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	if err := h.publisher.Publish(r.Context(), "daily.completed", events.DailyCompleted{
		Version:         1,
		UserID:          sharedhttp.UUIDToString(daily.UserID),
		DailyID:         sharedhttp.UUIDToString(daily.ID),
		Difficulty:      daily.Difficulty,
		RewardMaterials: int(reward.RewardMaterials),
	}); err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusOK, dailyToResponse(daily))
}

func validateCreateDailyRequest(req createDailyRequest) (map[string]string, time.Time) {
	fieldErrors := make(map[string]string)
	if req.Title == "" {
		fieldErrors["title"] = "title is required"
	}
	if _, ok := validDifficulties[req.Difficulty]; !ok {
		fieldErrors["difficulty"] = "must be one of: EASY, MEDIUM, HARD"
	}
	dueDate, err := time.Parse(time.RFC3339, req.DueDate)
	if err != nil {
		fieldErrors["due_date"] = "due_date must be a valid RFC3339 timestamp"
	}
	return fieldErrors, dueDate
}

func validateUpdateDailyRequest(req updateDailyRequest) (map[string]string, *time.Time) {
	fieldErrors := make(map[string]string)
	if req.Difficulty != "" {
		if _, ok := validDifficulties[req.Difficulty]; !ok {
			fieldErrors["difficulty"] = "must be one of: EASY, MEDIUM, HARD"
		}
	}
	if req.DueDate == "" {
		return fieldErrors, nil
	}
	dueDate, err := time.Parse(time.RFC3339, req.DueDate)
	if err != nil {
		fieldErrors["due_date"] = "due_date must be a valid RFC3339 timestamp"
		return fieldErrors, nil
	}
	return fieldErrors, &dueDate
}

func dailyToResponse(daily database.Daily) dailyResponse {
	return dailyResponse{
		ID:          sharedhttp.UUIDToString(daily.ID),
		UserID:      sharedhttp.UUIDToString(daily.UserID),
		Title:       daily.Title,
		Description: daily.Description,
		Difficulty:  daily.Difficulty,
		DueDate:     formatTimestamptz(daily.DueDate),
		Status:      daily.Status,
		CreatedAt:   formatTimestamptz(daily.CreatedAt),
		UpdatedAt:   formatTimestamptz(daily.UpdatedAt),
	}
}

func formatTimestamptz(ts pgtype.Timestamptz) string {
	if !ts.Valid {
		return ""
	}
	return ts.Time.UTC().Format(time.RFC3339)
}
