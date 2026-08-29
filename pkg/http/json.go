// Package http provides shared HTTP helpers used by the Galaxify services.
package http

import (
	"encoding/json"
	"net/http"
)

// WriteJSON encodes body as JSON with the given status. Body is a fixed,
// hand-authored struct, so encoding cannot fail from input — a failure at
// this point only means the client already disconnected.
func WriteJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
