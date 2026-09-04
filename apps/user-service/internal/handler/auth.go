package handler

import (
	"crypto/ed25519"
	"log/slog"
	"net/http"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

type AuthHandler struct {
	serviceName string
	publicKey   ed25519.PublicKey
	querier     database.Querier
	logger      *slog.Logger
}

func NewAuthHandler(serviceName string, publicKey ed25519.PublicKey, querier database.Querier, logger *slog.Logger) *AuthHandler {
	return &AuthHandler{
		serviceName: serviceName,
		publicKey:   publicKey,
		querier:     querier,
		logger:      logger,
	}
}

func (h *AuthHandler) RegisterAuthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/.well-known/jwks.json", h.GetJWKSJson)
}

func (h *AuthHandler) GetJWKSJson(w http.ResponseWriter, r *http.Request) {
	jwk, err := auth.PublicKeyToJWK(h.publicKey, h.serviceName)

	if err != nil {
		sharedhttp.WriteInternal(w, r, err, h.logger)
		return
	}

	sharedhttp.WriteJSON(w, http.StatusOK, jwk)
}
