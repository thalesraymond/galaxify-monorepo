package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"testing"
)

// mockFetchJWKS returns a mock fetch function for testing.
// It returns the provided JWKs and error without making HTTP calls.
func mockFetchJWKS(jwks []JWK, fetchErr error) func(ctx context.Context, url string) ([]JWK, error) {
	return func(ctx context.Context, url string) ([]JWK, error) {
		return jwks, fetchErr
	}
}

// generateTestJWK creates a valid Ed25519 JWK for testing.
// Returns the JWK, the private key, and the public key.
func generateTestJWK(t *testing.T, kid string) (JWK, ed25519.PrivateKey, ed25519.PublicKey) {
	t.Helper()

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}

	jwk := JWK{
		Kty: "OKP",
		Crv: "Ed25519",
		X:   base64.RawURLEncoding.EncodeToString(pub),
		Kid: kid,
		Use: "sig",
		Alg: "EdDSA",
	}

	return jwk, priv, pub
}

func TestNewSimpleJWKSCache(t *testing.T) {
	t.Parallel()

	cache := NewSimpleJWKSCache("http://example.com/jwks")

	if cache == nil {
		t.Fatal("expected non-nil cache")
	}
	if cache.jwksURL != "http://example.com/jwks" {
		t.Errorf("jwksURL = %q, want %q", cache.jwksURL, "http://example.com/jwks")
	}
	if cache.keys == nil {
		t.Error("expected keys map to be initialized")
	}
	if len(cache.keys) != 0 {
		t.Errorf("expected empty keys map, got %d entries", len(cache.keys))
	}
}

func TestSimpleJWKSCache_GetKey(t *testing.T) {
	t.Parallel()

	t.Run("returns key when present", func(t *testing.T) {
		t.Parallel()

		jwk, _, pub := generateTestJWK(t, "key-1")

		cache := NewSimpleJWKSCache("http://example.com/jwks")
		cache.fetchFn = mockFetchJWKS([]JWK{jwk}, nil)

		// Populate cache
		if err := cache.ForceRefresh(context.Background()); err != nil {
			t.Fatalf("ForceRefresh failed: %v", err)
		}

		// Retrieve key
		gotKey, ok := cache.GetKey("key-1")
		if !ok {
			t.Fatal("expected key to be found")
		}

		gotPub, ok := gotKey.(ed25519.PublicKey)
		if !ok {
			t.Fatalf("expected ed25519.PublicKey, got %T", gotKey)
		}

		if !gotPub.Equal(pub) {
			t.Error("retrieved key does not match original")
		}
	})

	t.Run("returns false when key not present", func(t *testing.T) {
		t.Parallel()

		cache := NewSimpleJWKSCache("http://example.com/jwks")

		gotKey, ok := cache.GetKey("nonexistent")
		if ok {
			t.Error("expected key not to be found")
		}
		if gotKey != nil {
			t.Errorf("expected nil key, got %v", gotKey)
		}
	})

	t.Run("returns correct key among multiple", func(t *testing.T) {
		t.Parallel()

		jwk1, _, pub1 := generateTestJWK(t, "key-1")
		jwk2, _, pub2 := generateTestJWK(t, "key-2")
		jwk3, _, pub3 := generateTestJWK(t, "key-3")

		cache := NewSimpleJWKSCache("http://example.com/jwks")
		cache.fetchFn = mockFetchJWKS([]JWK{jwk1, jwk2, jwk3}, nil)

		if err := cache.ForceRefresh(context.Background()); err != nil {
			t.Fatalf("ForceRefresh failed: %v", err)
		}

		// Verify each key
		tests := []struct {
			kid     string
			wantPub ed25519.PublicKey
		}{
			{"key-1", pub1},
			{"key-2", pub2},
			{"key-3", pub3},
		}

		for _, tt := range tests {
			gotKey, ok := cache.GetKey(tt.kid)
			if !ok {
				t.Errorf("key %q not found", tt.kid)
				continue
			}
			gotPub := gotKey.(ed25519.PublicKey)
			if !gotPub.Equal(tt.wantPub) {
				t.Errorf("key %q does not match", tt.kid)
			}
		}
	})
}

func TestSimpleJWKSCache_ForceRefresh(t *testing.T) {
	t.Parallel()

	t.Run("populates cache from JWKS", func(t *testing.T) {
		t.Parallel()

		jwk1, _, _ := generateTestJWK(t, "key-1")
		jwk2, _, _ := generateTestJWK(t, "key-2")

		cache := NewSimpleJWKSCache("http://example.com/jwks")
		cache.fetchFn = mockFetchJWKS([]JWK{jwk1, jwk2}, nil)

		if err := cache.ForceRefresh(context.Background()); err != nil {
			t.Fatalf("ForceRefresh failed: %v", err)
		}

		if _, ok := cache.GetKey("key-1"); !ok {
			t.Error("key-1 not found after refresh")
		}
		if _, ok := cache.GetKey("key-2"); !ok {
			t.Error("key-2 not found after refresh")
		}
	})

	t.Run("replaces cache on refresh", func(t *testing.T) {
		t.Parallel()

		jwk1, _, _ := generateTestJWK(t, "key-1")
		jwk2, _, _ := generateTestJWK(t, "key-2")

		cache := NewSimpleJWKSCache("http://example.com/jwks")

		// First refresh with key-1
		cache.fetchFn = mockFetchJWKS([]JWK{jwk1}, nil)
		if err := cache.ForceRefresh(context.Background()); err != nil {
			t.Fatalf("first ForceRefresh failed: %v", err)
		}

		if _, ok := cache.GetKey("key-1"); !ok {
			t.Error("key-1 not found after first refresh")
		}

		// Second refresh with key-2 (simulates key rotation)
		cache.fetchFn = mockFetchJWKS([]JWK{jwk2}, nil)
		if err := cache.ForceRefresh(context.Background()); err != nil {
			t.Fatalf("second ForceRefresh failed: %v", err)
		}

		// key-1 should be gone, key-2 should be present
		if _, ok := cache.GetKey("key-1"); ok {
			t.Error("key-1 should not exist after rotation")
		}
		if _, ok := cache.GetKey("key-2"); !ok {
			t.Error("key-2 not found after rotation")
		}
	})

	t.Run("skips invalid keys", func(t *testing.T) {
		t.Parallel()

		validJWK, _, _ := generateTestJWK(t, "valid-key")

		// Create an invalid JWK (wrong curve)
		invalidJWK := JWK{
			Kty: "OKP",
			Crv: "P-256", // wrong curve
			X:   "abc123",
			Kid: "invalid-key",
		}

		cache := NewSimpleJWKSCache("http://example.com/jwks")
		cache.fetchFn = mockFetchJWKS([]JWK{validJWK, invalidJWK}, nil)

		if err := cache.ForceRefresh(context.Background()); err != nil {
			t.Fatalf("ForceRefresh failed: %v", err)
		}

		// Valid key should be present
		if _, ok := cache.GetKey("valid-key"); !ok {
			t.Error("valid-key not found")
		}

		// Invalid key should be skipped
		if _, ok := cache.GetKey("invalid-key"); ok {
			t.Error("invalid-key should have been skipped")
		}
	})

	t.Run("returns error on fetch failure", func(t *testing.T) {
		t.Parallel()

		cache := NewSimpleJWKSCache("http://example.com/jwks")
		cache.fetchFn = mockFetchJWKS(nil, errors.New("network error"))

		err := cache.ForceRefresh(context.Background())
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})

	t.Run("handles empty JWKS", func(t *testing.T) {
		t.Parallel()

		cache := NewSimpleJWKSCache("http://example.com/jwks")
		cache.fetchFn = mockFetchJWKS([]JWK{}, nil)

		if err := cache.ForceRefresh(context.Background()); err != nil {
			t.Fatalf("ForceRefresh failed: %v", err)
		}

		// Cache should be empty but not error
		if len(cache.keys) != 0 {
			t.Errorf("expected empty cache, got %d keys", len(cache.keys))
		}
	})
}

func TestJwkToPublicKey(t *testing.T) {
	t.Parallel()

	t.Run("valid Ed25519 JWK", func(t *testing.T) {
		t.Parallel()

		pub, _, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatalf("failed to generate key: %v", err)
		}

		jwk := JWK{
			Kty: "OKP",
			Crv: "Ed25519",
			X:   base64.RawURLEncoding.EncodeToString(pub),
			Kid: "test-key",
		}

		gotKey, err := jwkToPublicKey(jwk)
		if err != nil {
			t.Fatalf("jwkToPublicKey failed: %v", err)
		}

		gotPub, ok := gotKey.(ed25519.PublicKey)
		if !ok {
			t.Fatalf("expected ed25519.PublicKey, got %T", gotKey)
		}

		if !gotPub.Equal(pub) {
			t.Error("converted key does not match original")
		}
	})

	t.Run("wrong key type", func(t *testing.T) {
		t.Parallel()

		jwk := JWK{
			Kty: "RSA", // wrong type
			Crv: "Ed25519",
			X:   "abc123",
			Kid: "test-key",
		}

		_, err := jwkToPublicKey(jwk)
		if err == nil {
			t.Fatal("expected error for wrong key type")
		}
	})

	t.Run("wrong curve", func(t *testing.T) {
		t.Parallel()

		jwk := JWK{
			Kty: "OKP",
			Crv: "P-256", // wrong curve
			X:   "abc123",
			Kid: "test-key",
		}

		_, err := jwkToPublicKey(jwk)
		if err == nil {
			t.Fatal("expected error for wrong curve")
		}
	})

	t.Run("invalid base64", func(t *testing.T) {
		t.Parallel()

		jwk := JWK{
			Kty: "OKP",
			Crv: "Ed25519",
			X:   "not-valid-base64!!!", // invalid characters
			Kid: "test-key",
		}

		_, err := jwkToPublicKey(jwk)
		if err == nil {
			t.Fatal("expected error for invalid base64")
		}
	})

	t.Run("wrong key size (too short)", func(t *testing.T) {
		t.Parallel()

		// Ed25519 public keys are 32 bytes; provide fewer
		shortKey := make([]byte, 16)
		jwk := JWK{
			Kty: "OKP",
			Crv: "Ed25519",
			X:   base64.RawURLEncoding.EncodeToString(shortKey),
			Kid: "test-key",
		}

		_, err := jwkToPublicKey(jwk)
		if err == nil {
			t.Fatal("expected error for wrong key size")
		}
	})

	t.Run("wrong key size (too long)", func(t *testing.T) {
		t.Parallel()

		// Ed25519 public keys are 32 bytes; provide more
		longKey := make([]byte, 64)
		jwk := JWK{
			Kty: "OKP",
			Crv: "Ed25519",
			X:   base64.RawURLEncoding.EncodeToString(longKey),
			Kid: "test-key",
		}

		_, err := jwkToPublicKey(jwk)
		if err == nil {
			t.Fatal("expected error for wrong key size")
		}
	})

	t.Run("roundtrip with PublicKeyToJWK", func(t *testing.T) {
		t.Parallel()

		// Generate original key
		pub, _, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatalf("failed to generate key: %v", err)
		}

		// Convert to JWK (using function from jwt.go)
		jwk, err := PublicKeyToJWK(pub, "test-key")
		if err != nil {
			t.Fatalf("PublicKeyToJWK failed: %v", err)
		}

		// Convert back to public key
		gotKey, err := jwkToPublicKey(jwk)
		if err != nil {
			t.Fatalf("jwkToPublicKey failed: %v", err)
		}

		gotPub := gotKey.(ed25519.PublicKey)

		// Should match original
		if !gotPub.Equal(pub) {
			t.Error("roundtrip failed: keys do not match")
		}
	})
}

// TestSimpleJWKSCache_ConcurrentAccess verifies thread safety.
// Run with: go test -race
func TestSimpleJWKSCache_ConcurrentAccess(t *testing.T) {
	t.Parallel()

	jwk, _, _ := generateTestJWK(t, "key-1")

	cache := NewSimpleJWKSCache("http://example.com/jwks")
	cache.fetchFn = mockFetchJWKS([]JWK{jwk}, nil)

	// Populate cache
	if err := cache.ForceRefresh(context.Background()); err != nil {
		t.Fatalf("ForceRefresh failed: %v", err)
	}

	// Run concurrent reads and writes
	done := make(chan bool)

	// Concurrent readers
	for i := 0; i < 10; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				cache.GetKey("key-1")
			}
			done <- true
		}()
	}

	// Concurrent writers
	for i := 0; i < 3; i++ {
		go func() {
			for j := 0; j < 10; j++ {
				cache.ForceRefresh(context.Background())
			}
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 13; i++ {
		<-done
	}
}
