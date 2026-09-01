package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
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
