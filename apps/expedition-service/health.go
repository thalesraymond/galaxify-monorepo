package main

import (
	"net/http"

	sharedhttp "github.com/thalesraymond/galaxify-monorepo/pkg/http"
)

// NewHealthHandler builds the service's HTTP handler on Go's stdlib ServeMux
// (see ADR-0002). All API routes are registered here.
func NewHealthHandler() *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		sharedhttp.WriteJSON(w, http.StatusOK, healthResponse{
			Status:  "ok",
			Service: serviceName,
		})
	})

	return mux
}

type healthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}
