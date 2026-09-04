package handler

import (
	"crypto/ed25519"
	"log/slog"
	"net/http"

	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// JWKSHandler exposes the public signing key in JWKS format.
type JWKSHandler struct {
	privateKey ed25519.PrivateKey
	kid        string
	logger     *slog.Logger
}

// NewJWKSHandler creates a JWKSHandler.
func NewJWKSHandler(privateKey ed25519.PrivateKey, kid string, logger *slog.Logger) *JWKSHandler {
	return &JWKSHandler{
		privateKey: privateKey,
		kid:        kid,
		logger:     logger,
	}
}

// RegisterRoutes wires the JWKS route into the given mux.
func (h *JWKSHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/.well-known/jwks.json", h.GetJWKS)
}

// GetJWKS returns the active Ed25519 public key as a JWKS document.
func (h *JWKSHandler) GetJWKS(w http.ResponseWriter, r *http.Request) {
	jwk, err := auth.PublicKeyToJWK(h.privateKey.Public().(ed25519.PublicKey), h.kid)
	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusOK, jwk)
}
