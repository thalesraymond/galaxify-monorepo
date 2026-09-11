package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"net/http"

	"github.com/google/uuid"

	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/expedition"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

const (
	expeditionAlreadyActiveCode         = "EXPEDITION_ALREADY_ACTIVE"
	expeditionCooldownCode              = "EXPEDITION_COOLDOWN"
	expeditionInsufficientMaterialsCode = "EXPEDITION_INSUFFICIENT_MATERIALS"
)

type expeditionLauncher interface {
	Launch(context.Context, uuid.UUID, expedition.LaunchInput) (expedition.Record, error)
}

// ExpeditionLaunchHandler translates authenticated launch requests.
type ExpeditionLaunchHandler struct {
	launcher      expeditionLauncher
	authHandshake *sharedhttp.AuthHandshake
	logger        *slog.Logger
}

// NewExpeditionLaunchHandler creates an ExpeditionLaunchHandler.
func NewExpeditionLaunchHandler(launcher expeditionLauncher, authHandshake *sharedhttp.AuthHandshake, logger *slog.Logger) *ExpeditionLaunchHandler {
	return &ExpeditionLaunchHandler{launcher: launcher, authHandshake: authHandshake, logger: logger}
}

// RegisterExpeditionLaunchRoutes wires the authenticated launch route into mux.
func (h *ExpeditionLaunchHandler) RegisterExpeditionLaunchRoutes(mux *http.ServeMux) {
	mux.Handle("POST /expeditions/launch", h.authHandshake.RequireAuth(h.Launch))
}

// Launch creates an expedition for the authenticated user.
func (h *ExpeditionLaunchHandler) Launch(w http.ResponseWriter, r *http.Request, userID string) {
	parsedUserID, ok := parseExpeditionUserID(w, userID)
	if !ok {
		return
	}

	var request struct {
		MaterialsInvested int64 `json:"materials_invested"`
	}
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&request); err != nil {
		writeInvalidLaunchJSON(w)
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeInvalidLaunchJSON(w)
		return
	}
	if request.MaterialsInvested <= 0 {
		sharedhttp.WriteValidationError(w, map[string]string{"materials_invested": "must be greater than 0"})
		return
	}
	if request.MaterialsInvested > math.MaxInt32 {
		sharedhttp.WriteValidationError(w, map[string]string{"materials_invested": "must be at most 2147483647"})
		return
	}

	record, err := h.launcher.Launch(r.Context(), parsedUserID, expedition.LaunchInput{
		MaterialsInvested: int32(request.MaterialsInvested),
		RequestID:         sharedhttp.RequestIDFromContext(r.Context()),
	})
	if err != nil {
		h.writeLaunchError(w, r, err)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusCreated, expeditionToResponse(record))
}

func writeInvalidLaunchJSON(w http.ResponseWriter) {
	sharedhttp.WriteJSON(w, http.StatusBadRequest, sharedhttp.ErrorResponse{
		Error: sharedhttp.ErrorBody{
			Code: "VALIDATION_FAILED", Message: "request validation failed",
			Details: &sharedhttp.ErrorDetails{FieldErrors: map[string]string{"body": "invalid JSON"}},
		},
	})
}

func (h *ExpeditionLaunchHandler) writeLaunchError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, expedition.ErrInvalidMaterials):
		sharedhttp.WriteValidationError(w, map[string]string{"materials_invested": "must be greater than 0"})
	case errors.Is(err, expedition.ErrInsufficientMaterials):
		sharedhttp.WriteError(w, http.StatusUnprocessableEntity, expeditionInsufficientMaterialsCode, "Insufficient materials to launch expedition")
	case errors.Is(err, expedition.ErrAlreadyActive):
		sharedhttp.WriteError(w, http.StatusConflict, expeditionAlreadyActiveCode, "An expedition is already active")
	case errors.Is(err, expedition.ErrCooldown):
		sharedhttp.WriteError(w, http.StatusUnprocessableEntity, expeditionCooldownCode, "Expedition launch is on cooldown")
	default:
		sharedhttp.WriteInternal(w, r, err, h.logger)
	}
}
