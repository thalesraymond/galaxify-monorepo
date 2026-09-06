package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/daily"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// dailyManager is the domain interface used by DailyHandler.
type dailyManager interface {
	Create(ctx context.Context, input daily.CreateInput) (daily.Daily, error)
	Get(ctx context.Context, userID, id uuid.UUID) (daily.Daily, error)
	List(ctx context.Context, userID uuid.UUID) ([]daily.Daily, error)
	Update(ctx context.Context, userID, id uuid.UUID, input daily.UpdateInput) (daily.Daily, error)
	Delete(ctx context.Context, userID, id uuid.UUID) error
	Complete(ctx context.Context, userID, id uuid.UUID) (daily.Daily, error)
}

// DailyHandler handles auth-protected CRUD endpoints for /dailies.
type DailyHandler struct {
	manager       dailyManager
	authHandshake *sharedhttp.AuthHandshake
	logger        *slog.Logger
}

// NewDailyHandler creates a DailyHandler.
func NewDailyHandler(manager dailyManager, authHandshake *sharedhttp.AuthHandshake, logger *slog.Logger) *DailyHandler {
	return &DailyHandler{
		manager:       manager,
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

func (h *DailyHandler) parseUserID(w http.ResponseWriter, userID string) (uuid.UUID, bool) {
	id, err := uuid.Parse(userID)
	if err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"user_id": "invalid UUID"})
		return uuid.Nil, false
	}
	return id, true
}

func (h *DailyHandler) parsePathID(w http.ResponseWriter, rawID string) (uuid.UUID, bool) {
	id, err := uuid.Parse(rawID)
	if err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"id": "invalid UUID"})
		return uuid.Nil, false
	}
	return id, true
}

// CreateDaily creates a new daily for the authenticated user.
func (h *DailyHandler) CreateDaily(w http.ResponseWriter, r *http.Request, userID string) {
	userUUID, ok := h.parseUserID(w, userID)
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

	item, err := h.manager.Create(r.Context(), daily.CreateInput{
		UserID:      userUUID,
		Title:       req.Title,
		Description: req.Description,
		Difficulty:  req.Difficulty,
		DueDate:     dueDate,
	})
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusCreated, dailyToResponse(item))
}

// ListDailies returns all dailies for the authenticated user.
func (h *DailyHandler) ListDailies(w http.ResponseWriter, r *http.Request, userID string) {
	userUUID, ok := h.parseUserID(w, userID)
	if !ok {
		return
	}

	items, err := h.manager.List(r.Context(), userUUID)
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	resp := make([]dailyResponse, len(items))
	for i, item := range items {
		resp[i] = dailyToResponse(item)
	}

	sharedhttp.WriteJSON(w, http.StatusOK, resp)
}

// GetDaily returns a single daily owned by the authenticated user.
func (h *DailyHandler) GetDaily(w http.ResponseWriter, r *http.Request, userID string) {
	userUUID, ok := h.parseUserID(w, userID)
	if !ok {
		return
	}

	dailyUUID, ok := h.parsePathID(w, r.PathValue("id"))
	if !ok {
		return
	}

	item, err := h.manager.Get(r.Context(), userUUID, dailyUUID)
	if err != nil {
		if errors.Is(err, daily.ErrDailyNotFound) {
			sharedhttp.WriteError(w, http.StatusNotFound, "DAILY_NOT_FOUND", "Daily not found")
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusOK, dailyToResponse(item))
}

// UpdateDaily edits a daily if it is still pending.
func (h *DailyHandler) UpdateDaily(w http.ResponseWriter, r *http.Request, userID string) {
	userUUID, ok := h.parseUserID(w, userID)
	if !ok {
		return
	}

	dailyUUID, ok := h.parsePathID(w, r.PathValue("id"))
	if !ok {
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

	input := daily.UpdateInput{}
	if req.Title != "" {
		input.Title = &req.Title
	}
	if req.Description != "" {
		input.Description = &req.Description
	}
	if req.Difficulty != "" {
		input.Difficulty = &req.Difficulty
	}
	if dueDate != nil {
		input.DueDate = dueDate
	}

	item, err := h.manager.Update(r.Context(), userUUID, dailyUUID, input)
	if err != nil {
		if errors.Is(err, daily.ErrDailyNotFound) {
			sharedhttp.WriteError(w, http.StatusNotFound, "DAILY_NOT_FOUND", "Daily not found")
			return
		}
		if errors.Is(err, daily.ErrDailyNotPending) {
			sharedhttp.WriteError(w, http.StatusConflict, "DAILY_NOT_EDITABLE", "Daily can only be edited while pending")
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusOK, dailyToResponse(item))
}

// DeleteDaily removes a daily if it is still pending.
func (h *DailyHandler) DeleteDaily(w http.ResponseWriter, r *http.Request, userID string) {
	userUUID, ok := h.parseUserID(w, userID)
	if !ok {
		return
	}

	dailyUUID, ok := h.parsePathID(w, r.PathValue("id"))
	if !ok {
		return
	}

	err := h.manager.Delete(r.Context(), userUUID, dailyUUID)
	if err != nil {
		if errors.Is(err, daily.ErrDailyNotFound) {
			sharedhttp.WriteError(w, http.StatusNotFound, "DAILY_NOT_FOUND", "Daily not found")
			return
		}
		if errors.Is(err, daily.ErrDailyNotPending) {
			sharedhttp.WriteError(w, http.StatusConflict, "DAILY_NOT_EDITABLE", "Daily can only be deleted while pending")
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// CompleteDaily marks a pending daily as COMPLETED and publishes a daily.completed event.
func (h *DailyHandler) CompleteDaily(w http.ResponseWriter, r *http.Request, userID string) {
	userUUID, ok := h.parseUserID(w, userID)
	if !ok {
		return
	}

	dailyUUID, ok := h.parsePathID(w, r.PathValue("id"))
	if !ok {
		return
	}

	item, err := h.manager.Complete(r.Context(), userUUID, dailyUUID)
	if err != nil {
		if errors.Is(err, daily.ErrDailyNotFound) {
			sharedhttp.WriteError(w, http.StatusNotFound, "DAILY_NOT_FOUND", "Daily not found")
			return
		}
		if errors.Is(err, daily.ErrDailyAlreadyCompleted) || errors.Is(err, daily.ErrDailyNotPending) {
			sharedhttp.WriteError(w, http.StatusConflict, "DAILY_ALREADY_COMPLETED", "Daily is not pending")
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusOK, dailyToResponse(item))
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

func dailyToResponse(item daily.Daily) dailyResponse {
	return dailyResponse{
		ID:          item.ID.String(),
		UserID:      item.UserID.String(),
		Title:       item.Title,
		Description: item.Description,
		Difficulty:  item.Difficulty,
		DueDate:     formatTime(item.DueDate),
		Status:      item.Status,
		CreatedAt:   formatTime(item.CreatedAt),
		UpdatedAt:   formatTime(item.UpdatedAt),
	}
}

func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}
