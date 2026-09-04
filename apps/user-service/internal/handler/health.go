package handler

import (
	"net/http"

	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

type UserHealthHandler struct {
	serviceName string
}

func NewUserHealthHandler(serviceName string) *UserHealthHandler {
	return &UserHealthHandler{serviceName: serviceName}
}

func (h *UserHealthHandler) RegisterHealthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		sharedhttp.WriteJSON(w, http.StatusOK, healthResponse{
			Status:  "ok",
			Service: h.serviceName,
		})
	})
}

type healthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}
