package handler

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/ship"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

const (
	// shipNotFoundCode identifies a repair request for an unprovisioned ship.
	shipNotFoundCode = "SHIP_NOT_FOUND"
	// shipHullFullCode identifies a repair request for a fully restored hull.
	shipHullFullCode = "SHIP_HULL_FULL"
	// shipInsufficientMaterialsCode identifies a repair request without repair materials.
	shipInsufficientMaterialsCode = "SHIP_INSUFFICIENT_MATERIALS"
)

// ShipHandler translates authenticated ship HTTP requests to the ship domain.
type ShipHandler struct {
	manager       ship.Manager
	authHandshake *sharedhttp.AuthHandshake
	logger        *slog.Logger
}

// NewShipHandler creates a ShipHandler.
func NewShipHandler(manager ship.Manager, authHandshake *sharedhttp.AuthHandshake, logger *slog.Logger) *ShipHandler {
	return &ShipHandler{manager: manager, authHandshake: authHandshake, logger: logger}
}

// RegisterShipRoutes wires auth-protected ship routes into mux.
func (h *ShipHandler) RegisterShipRoutes(mux *http.ServeMux) {
	mux.Handle("POST /ships/repair", h.authHandshake.RequireAuth(h.Repair))
}

// Repair spends available materials to restore the authenticated user's hull.
func (h *ShipHandler) Repair(w http.ResponseWriter, r *http.Request, userID string) {
	if err := rejectNonEmptyBody(r); err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"body": "must be empty"})
		return
	}

	parsedUserID, err := uuid.Parse(userID)
	if err != nil {
		sharedhttp.WriteValidationError(w, map[string]string{"user_id": "invalid UUID"})
		return
	}
	state, err := h.manager.Repair(r.Context(), parsedUserID)
	if err != nil {
		switch {
		case errors.Is(err, ship.ErrNotFound):
			sharedhttp.WriteError(w, http.StatusNotFound, shipNotFoundCode, "Ship not found")
		case errors.Is(err, ship.ErrHullFull):
			sharedhttp.WriteError(w, http.StatusUnprocessableEntity, shipHullFullCode, "Ship hull is already full")
		case errors.Is(err, ship.ErrInsufficientMaterials):
			sharedhttp.WriteError(w, http.StatusUnprocessableEntity, shipInsufficientMaterialsCode, "Insufficient materials for repair")
		default:
			sharedhttp.WriteInternal(w, r, err, h.logger)
		}
		return
	}
	sharedhttp.WriteJSON(w, http.StatusOK, shipToResponse(state))
}

func rejectNonEmptyBody(r *http.Request) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1))
	if err != nil {
		return err
	}
	if len(body) == 0 {
		return nil
	}
	return errors.New("request body is not empty")
}

// shipResponse is the on-the-wire shape for a ship's current state.
type shipResponse struct {
	UserID           string `json:"user_id"`
	HullHealth       int32  `json:"hull_health"`
	MaterialsBalance int32  `json:"materials_balance"`
	Level            int32  `json:"level"`
	UpdatedAt        string `json:"updated_at"`
}

func shipToResponse(state ship.State) shipResponse {
	return shipResponse{
		UserID:           state.UserID.String(),
		HullHealth:       state.HullHealth,
		MaterialsBalance: state.MaterialsBalance,
		Level:            state.Level,
		UpdatedAt:        state.UpdatedAt.Format(time.RFC3339Nano),
	}
}
