// Package auth provides JWT-based authentication for Galaxify services.
//
// This file implements JWKS (JSON Web Key Set) caching, which is essential for
// efficient JWT verification in a microservices architecture.
//
// # Background: Why JWKS Caching?
//
// In our system, the user-service issues JWTs signed with EdDSA (Ed25519).
// Other services (daily-service, ship-service, etc.) need to verify these JWTs
// but don't have the signing keys. Instead, they fetch public keys from the
// user-service's JWKS endpoint (e.g., https://user-service/.well-known/jwks.json).
//
// A JWKS document looks like:
//
//	{
//	  "keys": [
//	    {
//	      "kty": "OKP",           // Key Type: Octet Key Pair
//	      "crv": "Ed25519",       // Curve: Ed25519
//	      "x": "base64url...",    // Public key bytes (base64url-encoded)
//	      "kid": "key-1",         // Key ID (matches JWT header's "kid")
//	      "use": "sig",           // Usage: signature
//	      "alg": "EdDSA"          // Algorithm: EdDSA
//	    }
//	  ]
//	}
//
// # The Problem
//
// Fetching the JWKS on every request would be slow and put load on the
// user-service. We need to cache the keys locally.
//
// # The Solution
//
// JWKSCache provides:
//   - In-memory caching of public keys by their "kid" (key ID)
//   - Thread-safe access via sync.RWMutex (multiple readers, single writer)
//   - ForceRefresh() to fetch fresh keys when a JWT has an unknown "kid"
//     (e.g., after key rotation)
//
// # Key Rotation
//
// When the user-service rotates keys (issues a new signing key), it publishes
// the new public key in the JWKS. Services will see JWTs with a new "kid" they
// don't recognize. The middleware calls ForceRefresh() to fetch the updated JWKS,
// then retries verification with the new key.
package auth

import (
	"context"
	"crypto"
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"sync"
)

// JWKSCache is the interface for caching JWKS public keys.
//
// Implementations must be safe for concurrent use by multiple goroutines.
type JWKSCache interface {
	// GetKey returns the public key for the given key ID (kid).
	//
	// The kid comes from the JWT header and identifies which key was used to
	// sign the token. Returns (nil, false) if the kid is not in the cache.
	// The bool return (not error) is idiomatic for "found or not" lookups.
	GetKey(kid string) (crypto.PublicKey, bool)

	// ForceRefresh fetches a fresh JWKS document from the configured endpoint
	// and updates the cache.
	//
	// Call this when GetKey returns false for a JWT's kid - the key may have
	// been rotated and the new key needs to be fetched.
	ForceRefresh(ctx context.Context) error
}

// SimpleJWKSCache is an in-memory JWKS cache implementation.
//
// Thread Safety: Uses sync.RWMutex to allow concurrent reads (GetKey) while
// ensuring exclusive writes (ForceRefresh). This is critical because HTTP
// servers handle requests concurrently.
type SimpleJWKSCache struct {
	// mu protects the keys map. RWMutex allows multiple goroutines to read
	// simultaneously (RLock) but only one to write (Lock).
	mu sync.RWMutex

	// keys maps key ID (kid) to the corresponding Ed25519 public key.
	// Populated by ForceRefresh and read by GetKey.
	keys map[string]crypto.PublicKey

	// jwksURL is the endpoint to fetch the JWKS document from.
	// Example: "http://user-service:8080/.well-known/jwks.json"
	jwksURL string

	// fetchFn is the function used to fetch JWKS. Defaults to FetchJWKS.
	// Exposed for testing - tests can inject a mock fetcher.
	fetchFn func(ctx context.Context, url string) ([]JWK, error)
}

// NewSimpleJWKSCache creates a new cache that will fetch keys from jwksURL.
//
// The cache starts empty - call ForceRefresh() to populate it before use,
// or let the middleware call it on-demand when a JWT has an unknown kid.
func NewSimpleJWKSCache(jwksURL string) *SimpleJWKSCache {
	return &SimpleJWKSCache{
		keys:    make(map[string]crypto.PublicKey),
		jwksURL: jwksURL,
		fetchFn: FetchJWKS, // default fetcher from jwt.go
	}
}

// GetKey retrieves a cached public key by its key ID.
//
// Uses RLock (read lock) so multiple goroutines can read simultaneously.
// Returns (nil, false) if the kid is not in the cache.
func (c *SimpleJWKSCache) GetKey(kid string) (crypto.PublicKey, bool) {
	c.mu.RLock()         // acquire read lock (shared)
	defer c.mu.RUnlock() // release when done
	key, ok := c.keys[kid]
	return key, ok
}

// ForceRefresh fetches the JWKS document and replaces the cache contents.
//
// Flow:
//  1. Fetch JWKS from the configured URL (HTTP GET)
//  2. Parse each JWK and convert to ed25519.PublicKey
//  3. Replace the entire cache atomically (under write lock)
//
// Invalid keys (wrong format, wrong curve, etc.) are silently skipped.
// This ensures a single malformed key doesn't break the entire cache.
//
// Uses Lock (write lock) so no other goroutine can read or write during update.
func (c *SimpleJWKSCache) ForceRefresh(ctx context.Context) error {
	// Step 1: Fetch the JWKS document from the user-service
	jwks, err := c.fetchFn(ctx, c.jwksURL)
	if err != nil {
		return fmt.Errorf("failed to fetch JWKS: %w", err)
	}

	// Step 2: Acquire exclusive write lock
	c.mu.Lock()
	defer c.mu.Unlock()

	// Step 3: Replace the entire cache (atomic swap)
	// We create a new map rather than updating in-place to ensure consistency.
	c.keys = make(map[string]crypto.PublicKey)

	// Step 4: Convert each JWK to a public key and add to cache
	for _, jwk := range jwks {
		pubKey, err := jwkToPublicKey(jwk)
		if err != nil {
			// Skip invalid keys - log in production, but don't fail the refresh
			continue
		}
		c.keys[jwk.Kid] = pubKey
	}

	return nil
}

// jwkToPublicKey converts a JWK (JSON Web Key) to an Ed25519 public key.
//
// JWK format (RFC 7517):
//   - kty: Key Type (must be "OKP" for Octet Key Pair)
//   - crv: Curve (must be "Ed25519" for our use case)
//   - x:   Public key bytes, base64url-encoded (no padding)
//   - kid: Key ID (used to match JWT header's "kid")
//
// The "x" field contains the raw 32-byte Ed25519 public key, encoded as
// base64url (RFC 4648 §5) without padding. This is the standard encoding
// for JWKs.
//
// Validation:
//   - kty must be "OKP" (Octet Key Pair)
//   - crv must be "Ed25519" (we only support Ed25519)
//   - x must decode to exactly 32 bytes (ed25519.PublicKeySize)
func jwkToPublicKey(jwk JWK) (crypto.PublicKey, error) {
	// Validate key type: OKP = Octet Key Pair (used for Ed25519, X25519, etc.)
	if jwk.Kty != "OKP" {
		return nil, fmt.Errorf("unsupported key type: %s (want OKP)", jwk.Kty)
	}

	// Validate curve: we only support Ed25519 for JWT signing
	if jwk.Crv != "Ed25519" {
		return nil, fmt.Errorf("unsupported curve: %s (want Ed25519)", jwk.Crv)
	}

	// Decode the base64url-encoded public key.
	// RawURLEncoding = base64url without padding (RFC 4648 §5).
	// This is the standard encoding for JWK "x" values.
	keyBytes, err := base64.RawURLEncoding.DecodeString(jwk.X)
	if err != nil {
		return nil, fmt.Errorf("failed to decode public key: %w", err)
	}

	// Validate key size: Ed25519 public keys are exactly 32 bytes.
	// This catches truncated or corrupted keys.
	if len(keyBytes) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("invalid public key size: got %d, want %d", len(keyBytes), ed25519.PublicKeySize)
	}

	// Convert raw bytes to ed25519.PublicKey type.
	// ed25519.PublicKey is just []byte under the hood.
	return ed25519.PublicKey(keyBytes), nil
}
