package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestIssueAndVerifyAccessToken(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	tokenString, err := IssueAccessToken(priv, "key-1", "user-123", "a@example.com")
	if err != nil {
		t.Fatal(err)
	}

	claims, err := VerifyAccessToken(priv.Public(), tokenString)
	if err != nil {
		t.Fatal(err)
	}

	if claims.Subject != "user-123" {
		t.Errorf("sub = %q, want user-123", claims.Subject)
	}
	if claims.Email != "a@example.com" {
		t.Errorf("email = %q, want a@example.com", claims.Email)
	}
	if claims.Issuer != issuer {
		t.Errorf("iss = %q, want %q", claims.Issuer, issuer)
	}
}

func TestVerifyAccessTokenExpired(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	// Issue a token with a zero lifetime so it expires immediately.
	oldLifetime := AccessTokenLifetime
	AccessTokenLifetime = 0
	defer func() { AccessTokenLifetime = oldLifetime }()

	tokenString, err := IssueAccessToken(priv, "key-1", "user-123", "a@example.com")
	if err != nil {
		t.Fatal(err)
	}
	// Ensure expiration is in the past.
	time.Sleep(10 * time.Millisecond)

	_, err = VerifyAccessToken(priv.Public(), tokenString)
	if err == nil {
		t.Fatal("expected expired token error")
	}
	if !errors.Is(err, jwt.ErrTokenExpired) {
		t.Fatalf("expected ErrTokenExpired, got %v", err)
	}
}

func TestPublicKeyToJWK(t *testing.T) {
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	jwk, err := PublicKeyToJWK(pub, "test-key-1")
	if err != nil {
		t.Fatal(err)
	}

	if jwk.Kty != "OKP" {
		t.Errorf("kty = %q, want OKP", jwk.Kty)
	}
	if jwk.Crv != "Ed25519" {
		t.Errorf("crv = %q, want Ed25519", jwk.Crv)
	}
	if jwk.Kid != "test-key-1" {
		t.Errorf("kid = %q, want test-key-1", jwk.Kid)
	}
	if jwk.Use != "sig" {
		t.Errorf("use = %q, want sig", jwk.Use)
	}
	if jwk.Alg != "EdDSA" {
		t.Errorf("alg = %q, want EdDSA", jwk.Alg)
	}

	// Verify x is base64url-encoded raw public key (no padding).
	decoded, err := base64.RawURLEncoding.DecodeString(jwk.X)
	if err != nil {
		t.Fatalf("failed to decode x: %v", err)
	}
	if len(decoded) != ed25519.PublicKeySize {
		t.Errorf("decoded x length = %d, want %d", len(decoded), ed25519.PublicKeySize)
	}
}

func TestFetchJWKS(t *testing.T) {
	// Create a test JWKS document.
	jwks := jwksDocument{
		Keys: []JWK{
			{Kty: "OKP", Crv: "Ed25519", X: "abc123", Kid: "key-1", Use: "sig", Alg: "EdDSA"},
			{Kty: "OKP", Crv: "Ed25519", X: "def456", Kid: "key-2", Use: "sig", Alg: "EdDSA"},
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jwks)
	}))
	defer server.Close()

	keys, err := FetchJWKS(context.Background(), server.URL)
	if err != nil {
		t.Fatal(err)
	}

	if len(keys) != 2 {
		t.Fatalf("got %d keys, want 2", len(keys))
	}
	if keys[0].Kid != "key-1" {
		t.Errorf("keys[0].kid = %q, want key-1", keys[0].Kid)
	}
	if keys[1].Kid != "key-2" {
		t.Errorf("keys[1].kid = %q, want key-2", keys[1].Kid)
	}
}
