package handler

import (
	"context"
	"errors"
	"log/slog"
	"math"
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
	Quote(context.Context, uuid.UUID, int32) (expedition.Quote, error)
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
	mux.Handle("GET /expeditions/quote", h.authHandshake.RequireAuth(h.Quote))
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

// Quote returns the authoritative launch quote for a proposed investment.
// It reports eligibility instead of rejecting ineligible launches, so the
// frontend can explain the blocker before the Player acts.
func (h *ExpeditionReadHandler) Quote(w http.ResponseWriter, r *http.Request, userID string) {
	parsedUserID, ok := parseExpeditionUserID(w, userID)
	if !ok {
		return
	}
	materialsInvested, err := parseQuoteMaterials(r)
	if err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"materials_invested": err.Error()})
		return
	}
	quote, err := h.manager.Quote(r.Context(), parsedUserID, materialsInvested)
	if err != nil {
		h.writeQuoteError(w, r, err)
		return
	}
	sharedhttp.WriteJSON(w, http.StatusOK, quoteToResponse(quote))
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
		switch {
		case errors.Is(err, expedition.ErrNotFound):
			sharedhttp.WriteError(w, http.StatusNotFound, expeditionNotFoundCode, "Expedition not found")
		case errors.Is(err, expedition.ErrShipStateNotReady):
			sharedhttp.WriteError(w, http.StatusServiceUnavailable, expeditionShipStateNotReadyCode, "Ship state is not ready")
		default:
			sharedhttp.WriteInternal(w, r, err, h.logger)
		}
		return
	}
	sharedhttp.WriteJSON(w, http.StatusOK, expeditionToResponse(record))
}

func (h *ExpeditionReadHandler) writeQuoteError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, expedition.ErrShipStateNotReady):
		sharedhttp.WriteError(w, http.StatusServiceUnavailable, expeditionShipStateNotReadyCode, "Ship state is not ready")
	case errors.Is(err, expedition.ErrInvalidMaterials):
		sharedhttp.WriteValidationError(w, map[string]string{"materials_invested": "must be greater than 0"})
	default:
		sharedhttp.WriteInternal(w, r, err, h.logger)
	}
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

func parseQuoteMaterials(r *http.Request) (int32, error) {
	raw := r.URL.Query().Get("materials_invested")
	if raw == "" {
		return 0, errors.New("must be provided")
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 1 {
		return 0, errors.New("must be greater than 0")
	}
	if value > math.MaxInt32 {
		return 0, errors.New("must be at most 2147483647")
	}
	return int32(value), nil
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
	ID             string                 `json:"id"`
	ExpeditionID   string                 `json:"expedition_id"`
	Outcome        string                 `json:"outcome"`
	MaterialReward materialRewardResponse `json:"material_reward"`
	CreatedAt      string                 `json:"created_at"`
}

type materialRewardResponse struct {
	Materials int32 `json:"materials"`
}

type expeditionQuoteResponse struct {
	MaterialsInvested             int32   `json:"materials_invested"`
	NormalizedInvestment          float64 `json:"normalized_investment"`
	ProjectedBalance              int32   `json:"projected_balance"`
	SuccessChance                 float64 `json:"success_chance"`
	Eligible                      bool    `json:"eligible"`
	Blocker                       *string `json:"blocker"`
	CooldownUntil                 *string `json:"cooldown_until"`
	EstimatedResolveAt            string  `json:"estimated_resolve_at"`
	EstimatedResolveWindowSeconds int64   `json:"estimated_resolve_window_seconds"`
}

func expeditionToResponse(record expedition.Record) expeditionResponse {
	response := expeditionResponse{
		ID:                record.ID.String(),
		UserID:            record.UserID.String(),
		MaterialsInvested: record.MaterialsInvested,
		SuccessChance:     record.SuccessChance,
		ResolveAt:         record.ResolveAt.UTC().Format(time.RFC3339Nano),
		Status:            record.Status,
		CreatedAt:         record.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	if record.ResolvedAt != nil {
		resolvedAt := record.ResolvedAt.UTC().Format(time.RFC3339Nano)
		response.ResolvedAt = &resolvedAt
	}
	if record.Result != nil {
		response.Result = &expeditionResultResponse{
			ID:             record.Result.ID.String(),
			ExpeditionID:   record.Result.ExpeditionID.String(),
			Outcome:        record.Result.Outcome,
			MaterialReward: materialRewardResponse{Materials: record.Result.MaterialsReward},
			CreatedAt:      record.Result.CreatedAt.UTC().Format(time.RFC3339Nano),
		}
	}
	return response
}

func quoteToResponse(quote expedition.Quote) expeditionQuoteResponse {
	response := expeditionQuoteResponse{
		MaterialsInvested:             quote.MaterialsInvested,
		NormalizedInvestment:          quote.NormalizedInvestment,
		ProjectedBalance:              quote.ProjectedBalance,
		SuccessChance:                 quote.SuccessChance,
		Eligible:                      quote.Eligible,
		EstimatedResolveAt:            quote.EstimatedResolveAt.UTC().Format(time.RFC3339Nano),
		EstimatedResolveWindowSeconds: int64(quote.EstimatedResolveWindow / time.Second),
	}
	if quote.Blocker != expedition.BlockerNone {
		blocker := string(quote.Blocker)
		response.Blocker = &blocker
	}
	if quote.CooldownUntil != nil {
		cooldownUntil := quote.CooldownUntil.UTC().Format(time.RFC3339Nano)
		response.CooldownUntil = &cooldownUntil
	}
	return response
}
