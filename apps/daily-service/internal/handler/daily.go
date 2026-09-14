package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/thalesraymond/galaxify-monorepo/apps/daily-service/internal/daily"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// dailyManager is the domain interface used by DailyHandler.
type dailyManager interface {
	Create(ctx context.Context, input daily.CreateInput) (daily.Daily, error)
	Get(ctx context.Context, userID, id uuid.UUID) (daily.Daily, error)
	List(ctx context.Context, userID uuid.UUID, filter daily.ListFilter) ([]daily.Daily, error)
	ListHistory(ctx context.Context, userID uuid.UUID, query daily.HistoryQuery) (daily.HistoryPage, error)
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
	mux.Handle("GET /dailies/history", h.authHandshake.RequireAuth(h.ListDailyHistory))
	mux.Handle("GET /dailies/{id}", h.authHandshake.RequireAuth(h.GetDaily))
	mux.Handle("PATCH /dailies/{id}", h.authHandshake.RequireAuth(h.UpdateDaily))
	mux.Handle("DELETE /dailies/{id}", h.authHandshake.RequireAuth(h.DeleteDaily))
	mux.Handle("POST /dailies/{id}/complete", h.authHandshake.RequireAuth(h.CompleteDaily))
}

// dailyResponse is the on-the-wire shape for a daily resource.
type dailyResponse struct {
	ID           string `json:"id"`
	UserID       string `json:"user_id"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	Difficulty   string `json:"difficulty"`
	DueDate      string `json:"due_date"`
	TimeZone     string `json:"time_zone"`
	DueLocalDate string `json:"due_local_date"`
	DueLocalTime string `json:"due_local_time"`
	Status       string `json:"status"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

// dailyHistoryResponse is the on-the-wire shape for a daily history record.
type dailyHistoryResponse struct {
	ID           string  `json:"id"`
	DailyID      string  `json:"daily_id"`
	UserID       string  `json:"user_id"`
	Title        string  `json:"title"`
	Description  string  `json:"description"`
	Difficulty   string  `json:"difficulty"`
	DueDate      string  `json:"due_date"`
	TimeZone     string  `json:"time_zone"`
	DueLocalDate string  `json:"due_local_date"`
	DueLocalTime string  `json:"due_local_time"`
	Status       string  `json:"status"`
	CompletedAt  *string `json:"completed_at"`
	MissedAt     *string `json:"missed_at"`
	ArchivedAt   string  `json:"archived_at"`
}

// dailyHistoryPageResponse is the on-the-wire shape for one history page.
// next_cursor is null exactly when items is the final page.
type dailyHistoryPageResponse struct {
	Items      []dailyHistoryResponse `json:"items"`
	NextCursor *string                `json:"next_cursor"`
}

type createDailyRequest struct {
	Title        string `json:"title"`
	Description  string `json:"description"`
	Difficulty   string `json:"difficulty"`
	DueDate      string `json:"due_date"`
	TimeZone     string `json:"time_zone"`
	DueLocalDate string `json:"due_local_date"`
	DueLocalTime string `json:"due_local_time"`
}

// deadlineFields groups the mutually related deadline inputs so the create and
// update validators share one resolution path.
type deadlineFields struct {
	DueDate      string
	DueLocalDate string
	DueLocalTime string
	TimeZone     string
}

func (req createDailyRequest) deadlineFields() deadlineFields {
	return deadlineFields{
		DueDate:      req.DueDate,
		DueLocalDate: req.DueLocalDate,
		DueLocalTime: req.DueLocalTime,
		TimeZone:     req.TimeZone,
	}
}

type updateDailyRequest struct {
	Title        string `json:"title"`
	Description  string `json:"description"`
	Difficulty   string `json:"difficulty"`
	DueDate      string `json:"due_date"`
	TimeZone     string `json:"time_zone"`
	DueLocalDate string `json:"due_local_date"`
	DueLocalTime string `json:"due_local_time"`
}

func (req updateDailyRequest) deadlineFields() deadlineFields {
	return deadlineFields{
		DueDate:      req.DueDate,
		DueLocalDate: req.DueLocalDate,
		DueLocalTime: req.DueLocalTime,
		TimeZone:     req.TimeZone,
	}
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
		Difficulty:  daily.Difficulty(req.Difficulty),
		DueDate:     dueDate,
		TimeZone:    req.TimeZone,
	})
	if err != nil {
		if errors.Is(err, daily.ErrInvalidDifficulty) {
			sharedhttp.WriteValidationError(w, map[string]string{"difficulty": "must be one of: EASY, MEDIUM, HARD"})
			return
		}
		if errors.Is(err, daily.ErrInvalidTimeZone) {
			sharedhttp.WriteValidationError(w, map[string]string{"time_zone": "must be a valid IANA time zone"})
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusCreated, dailyToResponse(item))
}

// ListDailies returns all dailies for the authenticated user, optionally filtered by status and an instant range.
func (h *DailyHandler) ListDailies(w http.ResponseWriter, r *http.Request, userID string) {
	userUUID, ok := h.parseUserID(w, userID)
	if !ok {
		return
	}

	filter := daily.ListFilter{}
	q := r.URL.Query()

	if status := q.Get("status"); status != "" {
		s := daily.Status(status)
		if !daily.IsValidStatus(s) {
			sharedhttp.WriteValidationError(w, map[string]string{"status": "must be one of: PENDING, COMPLETED, MISSED"})
			return
		}
		filter.Status = &s
	}

	for name, target := range map[string]**time.Time{"from": &filter.From, "to": &filter.To} {
		if value := q.Get(name); value != "" {
			instant, err := time.Parse(time.RFC3339, value)
			if err != nil {
				sharedhttp.WriteValidationError(w, map[string]string{name: "must be a valid RFC3339 timestamp"})
				return
			}
			*target = &instant
		}
	}
	if filter.From == nil && filter.To == nil {
		from, to, errMsg := parseLegacyDateRange(q.Get("date"), q.Get("due_date"))
		if errMsg != "" {
			sharedhttp.WriteValidationError(w, map[string]string{"date": errMsg})
			return
		}
		filter.From, filter.To = from, to
	}
	if filter.From != nil && filter.To != nil && !filter.From.Before(*filter.To) {
		sharedhttp.WriteValidationError(w, map[string]string{"to": "must be after from"})
		return
	}

	items, err := h.manager.List(r.Context(), userUUID, filter)
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

// ListDailyHistory returns one stable descending page of the user's archived
// daily outcomes. A request may carry a bounded `limit` and the opaque `cursor`
// from a previous page's `next_cursor`.
func (h *DailyHandler) ListDailyHistory(w http.ResponseWriter, r *http.Request, userID string) {
	userUUID, ok := h.parseUserID(w, userID)
	if !ok {
		return
	}

	query := daily.HistoryQuery{Cursor: r.URL.Query().Get("cursor")}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err := strconv.ParseInt(raw, 10, 32)
		if err != nil || limit < 1 {
			sharedhttp.WriteValidationError(w, map[string]string{"limit": "must be a positive integer"})
			return
		}
		query.Limit = int(limit)
	}

	page, err := h.manager.ListHistory(r.Context(), userUUID, query)
	if err != nil {
		if errors.Is(err, daily.ErrInvalidHistoryCursor) {
			sharedhttp.WriteValidationError(w, map[string]string{"cursor": "is invalid or expired"})
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	resp := dailyHistoryPageResponse{Items: make([]dailyHistoryResponse, 0, len(page.Items))}
	for _, item := range page.Items {
		resp.Items = append(resp.Items, dailyHistoryToResponse(item))
	}
	if page.NextCursor != "" {
		cursor := page.NextCursor
		resp.NextCursor = &cursor
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

// UpdateDaily edits a daily.
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
		d := daily.Difficulty(req.Difficulty)
		input.Difficulty = &d
	}
	if dueDate != nil {
		input.DueDate = dueDate
	}
	if req.TimeZone != "" {
		input.TimeZone = &req.TimeZone
	}

	item, err := h.manager.Update(r.Context(), userUUID, dailyUUID, input)
	if err != nil {
		if errors.Is(err, daily.ErrDailyNotFound) {
			sharedhttp.WriteError(w, http.StatusNotFound, "DAILY_NOT_FOUND", "Daily not found")
			return
		}
		if errors.Is(err, daily.ErrInvalidDifficulty) {
			sharedhttp.WriteValidationError(w, map[string]string{"difficulty": "must be one of: EASY, MEDIUM, HARD"})
			return
		}
		if errors.Is(err, daily.ErrInvalidTimeZone) {
			sharedhttp.WriteValidationError(w, map[string]string{"time_zone": "must be a valid IANA time zone"})
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusOK, dailyToResponse(item))
}

// DeleteDaily removes a daily.
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
	if !daily.IsValidDifficulty(daily.Difficulty(req.Difficulty)) {
		fieldErrors["difficulty"] = "must be one of: EASY, MEDIUM, HARD"
	}

	zoneValid := true
	if req.TimeZone == "" {
		fieldErrors["time_zone"] = "time_zone is required"
		zoneValid = false
	} else if _, err := daily.LoadTimeZone(req.TimeZone); err != nil {
		fieldErrors["time_zone"] = "must be a valid IANA time zone"
		zoneValid = false
	}

	if !zoneValid {
		// A wall-clock deadline cannot be resolved without a valid zone, but do
		// not mask a missing deadline behind the zone error.
		fields := req.deadlineFields()
		if fields.DueDate == "" && fields.DueLocalDate == "" && fields.DueLocalTime == "" {
			fieldErrors["due_date"] = "due_date or a local deadline is required"
		}
		return fieldErrors, time.Time{}
	}

	dueDate, field, msg := resolveDeadline(req.deadlineFields(), true)
	if field != "" {
		fieldErrors[field] = msg
	}
	return fieldErrors, dueDate
}

func validateUpdateDailyRequest(req updateDailyRequest) (map[string]string, *time.Time) {
	fieldErrors := make(map[string]string)
	if req.Difficulty != "" {
		if !daily.IsValidDifficulty(daily.Difficulty(req.Difficulty)) {
			fieldErrors["difficulty"] = "must be one of: EASY, MEDIUM, HARD"
		}
	}

	zoneValid := true
	if req.TimeZone != "" {
		if _, err := daily.LoadTimeZone(req.TimeZone); err != nil {
			fieldErrors["time_zone"] = "must be a valid IANA time zone"
			zoneValid = false
		}
	}

	fields := req.deadlineFields()
	if fields.DueDate == "" && fields.DueLocalDate == "" && fields.DueLocalTime == "" {
		return fieldErrors, nil
	}
	if fields.DueLocalDate != "" || fields.DueLocalTime != "" {
		if req.TimeZone == "" {
			fieldErrors["time_zone"] = "is required with a local deadline"
			return fieldErrors, nil
		}
		if !zoneValid {
			return fieldErrors, nil
		}
	}

	dueDate, field, msg := resolveDeadline(fields, false)
	if field != "" {
		fieldErrors[field] = msg
		return fieldErrors, nil
	}
	return fieldErrors, &dueDate
}

// resolveDeadline returns the UTC deadline instant from either an explicit
// local wall-clock deadline resolved in time_zone, or a legacy RFC3339 instant.
// On failure it returns the offending field and message so the handler can
// surface a field-scoped validation error.
func resolveDeadline(fields deadlineFields, required bool) (time.Time, string, string) {
	if fields.DueLocalDate != "" || fields.DueLocalTime != "" {
		if fields.DueDate != "" {
			return time.Time{}, "due_date", "must not be supplied with due_local_date or due_local_time"
		}
		if fields.DueLocalDate == "" {
			return time.Time{}, "due_local_date", "is required with due_local_time"
		}
		if fields.DueLocalTime == "" {
			return time.Time{}, "due_local_time", "is required with due_local_date"
		}
		deadline, err := daily.ResolveLocalDeadline(fields.DueLocalDate, fields.DueLocalTime, fields.TimeZone)
		if err != nil {
			return time.Time{}, "due_local_date", "must be a valid local date and time"
		}
		return deadline, "", ""
	}
	if fields.DueDate == "" {
		if required {
			return time.Time{}, "due_date", "due_date or a local deadline is required"
		}
		return time.Time{}, "", ""
	}
	deadline, err := time.Parse(time.RFC3339, fields.DueDate)
	if err != nil {
		return time.Time{}, "due_date", "must be a valid RFC3339 timestamp"
	}
	return deadline, "", ""
}

// parseLegacyDateRange preserves the pre-#148 `date`/`due_date` filter contract:
// `date` wins over its `due_date` alias, and either a YYYY-MM-DD calendar day or
// an RFC3339 instant selects the single UTC calendar day it falls in.
func parseLegacyDateRange(date, dueDate string) (*time.Time, *time.Time, string) {
	value := date
	if value == "" {
		value = dueDate
	}
	if value == "" {
		return nil, nil, ""
	}
	day, err := time.Parse("2006-01-02", value)
	if err != nil {
		instant, rfcErr := time.Parse(time.RFC3339, value)
		if rfcErr != nil {
			return nil, nil, "date must be YYYY-MM-DD or RFC3339"
		}
		day = instant
	}
	from := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 1)
	return &from, &to, ""
}

func dailyToResponse(item daily.Daily) dailyResponse {
	localDate, localTime := formatLocalDeadline(item.DueDate, item.TimeZone)
	return dailyResponse{
		ID:           item.ID.String(),
		UserID:       item.UserID.String(),
		Title:        item.Title,
		Description:  item.Description,
		Difficulty:   string(item.Difficulty),
		DueDate:      formatTime(item.DueDate),
		TimeZone:     item.TimeZone,
		DueLocalDate: localDate,
		DueLocalTime: localTime,
		Status:       string(item.Status),
		CreatedAt:    formatTime(item.CreatedAt),
		UpdatedAt:    formatTime(item.UpdatedAt),
	}
}

func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func formatOptionalTime(t *time.Time) *string {
	if t == nil || t.IsZero() {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}

func dailyHistoryToResponse(item daily.DailyHistory) dailyHistoryResponse {
	localDate, localTime := formatLocalDeadline(item.DueDate, item.TimeZone)
	return dailyHistoryResponse{
		ID:           item.ID.String(),
		DailyID:      item.DailyID.String(),
		UserID:       item.UserID.String(),
		Title:        item.Title,
		Description:  item.Description,
		Difficulty:   string(item.Difficulty),
		DueDate:      formatTime(item.DueDate),
		TimeZone:     item.TimeZone,
		DueLocalDate: localDate,
		DueLocalTime: localTime,
		Status:       string(item.Status),
		CompletedAt:  formatOptionalTime(item.CompletedAt),
		MissedAt:     formatOptionalTime(item.MissedAt),
		ArchivedAt:   formatTime(item.ArchivedAt),
	}
}

func formatLocalDeadline(dueDate time.Time, timeZone string) (string, string) {
	location, err := daily.LoadTimeZone(timeZone)
	if err != nil || dueDate.IsZero() {
		return "", ""
	}
	local := dueDate.In(location)
	return local.Format("2006-01-02"), local.Format("15:04")
}
