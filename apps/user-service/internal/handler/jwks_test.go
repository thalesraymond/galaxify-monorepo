package handler

import (
	"crypto/ed25519"
	"crypto/rand"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
)

func TestGetJWKS(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := NewJWKSHandler(priv, "test-key", logger)

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	rec := httptest.NewRecorder()
	req := newTestRequest(t, http.MethodGet, "/.well-known/jwks.json", "")

	mux.ServeHTTP(rec, req)

	wantStatus(t, rec, http.StatusOK)

	var doc struct {
		Keys []auth.JWK `json:"keys"`
	}
	decodeBody(t, rec, &doc)
	if len(doc.Keys) != 1 {
		t.Fatalf("len(keys) = %d, want 1", len(doc.Keys))
	}
	jwk := doc.Keys[0]
	if jwk.Kid != "test-key" {
		t.Errorf("kid = %q, want test-key", jwk.Kid)
	}
	if jwk.Kty != "OKP" {
		t.Errorf("kty = %q, want OKP", jwk.Kty)
	}
}
