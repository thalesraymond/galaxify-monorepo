package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/expedition"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

const expeditionNotFoundCode = "EXPEDITION_NOT_FOUND"

type expeditionManager interface {
	Current(context.Context, uuid.UUID) (expedition.Record, error)
	Get(context.Context, uuid.UUID, uuid.UUID) (expedition.Record, error)
	List(context.Context, uuid.UUID, expedition.ListFilter) ([]expedition.Record, error)
}

// ExpeditionReadHandler translates authenticated expedition read requests.
type ExpeditionReadHandler struct {
	manager       expeditionManager
	authHandshake *sharedhttp.AuthHandshake
	logger        *slog.Logger
}

// NewExpeditionReadHandler creates an ExpeditionReadHandler.
func NewExpeditionReadHandler(manager expeditionManager, authHandshake *sharedhttp.AuthHandshake, logger *slog.Logger) *ExpeditionReadHandler {
	return &ExpeditionReadHandler{manager: manager, authHandshake: authHandshake, logger: logger}
}

// RegisterExpeditionReadRoutes wires authenticated expedition read routes into mux.
func (h *ExpeditionReadHandler) RegisterExpeditionReadRoutes(mux *http.ServeMux) {
	mux.Handle("GET /expeditions/current", h.authHandshake.RequireAuth(h.Current))
	mux.Handle("GET /expeditions/{id}", h.authHandshake.RequireAuth(h.Get))
	mux.Handle("GET /expeditions", h.authHandshake.RequireAuth(h.List))
}

// Current returns the authenticated user's active expedition.
func (h *ExpeditionReadHandler) Current(w http.ResponseWriter, r *http.Request, userID string) {
	parsedUserID, ok := parseExpeditionUserID(w, userID)
	if !ok {
		return
	}
	record, err := h.manager.Current(r.Context(), parsedUserID)
	h.writeRecord(w, r, record, err)
}

// Get returns one of the authenticated user's expeditions.
func (h *ExpeditionReadHandler) Get(w http.ResponseWriter, r *http.Request, userID string) {
	parsedUserID, ok := parseExpeditionUserID(w, userID)
	if !ok {
		return
	}
	expeditionID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"id": "invalid UUID"})
		return
	}
	record, err := h.manager.Get(r.Context(), parsedUserID, expeditionID)
	h.writeRecord(w, r, record, err)
}

// List returns the authenticated user's expedition history.
func (h *ExpeditionReadHandler) List(w http.ResponseWriter, r *http.Request, userID string) {
	parsedUserID, ok := parseExpeditionUserID(w, userID)
	if !ok {
		return
	}
	filter, err := parseExpeditionListFilter(r)
	if err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"query": err.Error()})
		return
	}
	records, err := h.manager.List(r.Context(), parsedUserID, filter)
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}
	response := make([]expeditionResponse, 0, len(records))
	for _, record := range records {
		response = append(response, expeditionToResponse(record))
	}
	sharedhttp.WriteJSON(w, http.StatusOK, response)
}

func (h *ExpeditionReadHandler) writeRecord(w http.ResponseWriter, r *http.Request, record expedition.Record, err error) {
	if err != nil {
		if errors.Is(err, expedition.ErrNotFound) {
			sharedhttp.WriteError(w, http.StatusNotFound, expeditionNotFoundCode, "Expedition not found")
			return
		}
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}
	sharedhttp.WriteJSON(w, http.StatusOK, expeditionToResponse(record))
}

func parseExpeditionUserID(w http.ResponseWriter, userID string) (uuid.UUID, bool) {
	parsedUserID, err := uuid.Parse(userID)
	if err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"user_id": "invalid UUID"})
		return uuid.Nil, false
	}
	return parsedUserID, true
}

func parseExpeditionListFilter(r *http.Request) (expedition.ListFilter, error) {
	const defaultLimit, maxLimit = 20, 100
	limit, err := parseNonNegativeQueryInt(r, "limit", defaultLimit)
	if err != nil {
		return expedition.ListFilter{}, err
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	offset, err := parseNonNegativeQueryInt(r, "offset", 0)
	if err != nil {
		return expedition.ListFilter{}, err
	}
	return expedition.ListFilter{Limit: int32(limit), Offset: int32(offset)}, nil
}

func parseNonNegativeQueryInt(r *http.Request, key string, fallback int) (int, error) {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseInt(raw, 10, 32)
	if err != nil || value < 0 {
		return 0, errors.New(key + " must be a non-negative integer")
	}
	return int(value), nil
}

type expeditionResponse struct {
	ID                string                    `json:"id"`
	UserID            string                    `json:"user_id"`
	MaterialsInvested int32                     `json:"materials_invested"`
	SuccessChance     float64                   `json:"success_chance"`
	ResolveAt         string                    `json:"resolve_at"`
	Status            string                    `json:"status"`
	CreatedAt         string                    `json:"created_at"`
	ResolvedAt        *string                   `json:"resolved_at,omitempty"`
	Result            *expeditionResultResponse `json:"result,omitempty"`
}

type expeditionResultResponse struct {
	ID            string `json:"id"`
	ExpeditionID  string `json:"expedition_id"`
	Outcome       string `json:"outcome"`
	RewardSummary any    `json:"reward_summary"`
	CreatedAt     string `json:"created_at"`
}

func expeditionToResponse(record expedition.Record) expeditionResponse {
	response := expeditionResponse{
		ID:                record.ID.String(),
		UserID:            record.UserID.String(),
		MaterialsInvested: record.MaterialsInvested,
		SuccessChance:     record.SuccessChance,
		ResolveAt:         record.ResolveAt.Format(time.RFC3339Nano),
		Status:            record.Status,
		CreatedAt:         record.CreatedAt.Format(time.RFC3339Nano),
	}
	if record.ResolvedAt != nil {
		resolvedAt := record.ResolvedAt.Format(time.RFC3339Nano)
		response.ResolvedAt = &resolvedAt
	}
	if record.Result != nil {
		response.Result = &expeditionResultResponse{
			ID:            record.Result.ID.String(),
			ExpeditionID:  record.Result.ExpeditionID.String(),
			Outcome:       record.Result.Outcome,
			RewardSummary: record.Result.RewardSummary,
			CreatedAt:     record.Result.CreatedAt.Format(time.RFC3339Nano),
		}
	}
	return response
}
