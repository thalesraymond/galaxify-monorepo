package main

import (
	"encoding/json"
	"net/http"
)

// newHandler builds the service's HTTP handler on Go's stdlib ServeMux
// (see ADR-0002). All API routes are registered here.
func newHandler() *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, healthResponse{
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

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	// Body is a fixed, hand-authored struct — encoding cannot fail from input,
	// and a failure at this point only means the client already disconnected.
	_ = json.NewEncoder(w).Encode(body)
}
