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
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// JWKSCache is the interface for caching JWKS public keys.
//
// Implementations must be safe for concurrent use by multiple goroutines.
var ErrUnknownKeyID = errors.New("auth: unknown key ID")

type JWKSCache interface {
	// GetKey returns the public key for the given key ID (kid).
	//
	// The kid comes from the JWT header and identifies which key was used to
	// sign the token. If the key is not in the cache, the implementation will
	// attempt to fetch it. If the key is still not found, returns ErrUnknownKeyID.
	GetKey(ctx context.Context, kid string) (crypto.PublicKey, error)
}

// SimpleJWKSCache is an in-memory JWKS cache implementation.
//
// Thread Safety: Uses sync.RWMutex to allow concurrent reads (GetKey) while
// ensuring exclusive writes (ForceRefresh). This is critical because HTTP
// servers handle requests concurrently.
type SimpleJWKSCache struct {
	// mu protects the keys map and refresh timestamps. RWMutex allows multiple goroutines to read
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

	// lastRefresh records when the cache was last refreshed.
	lastRefresh time.Time

	// minRefreshInterval specifies the minimum cooldown between consecutive JWKS refreshes
	// to prevent JWKS amplification and denial-of-service attacks.
	minRefreshInterval time.Duration

	group singleflight.Group
}

// NewSimpleJWKSCache creates a new cache that will fetch keys from jwksURL.
//
// The cache starts empty - call ForceRefresh() to populate it before use,
// or let the middleware call it on-demand when a JWT has an unknown kid.
func NewSimpleJWKSCache(jwksURL string) *SimpleJWKSCache {
	return &SimpleJWKSCache{
		keys:               make(map[string]crypto.PublicKey),
		jwksURL:            jwksURL,
		fetchFn:            FetchJWKS, // default fetcher from jwt.go
		minRefreshInterval: 10 * time.Second,
	}
}

// SetMinRefreshInterval configures the cooldown duration between consecutive JWKS fetches.
func (c *SimpleJWKSCache) SetMinRefreshInterval(interval time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.minRefreshInterval = interval
}

// GetKey retrieves a cached public key by its key ID.
//
// It handles cache misses by using singleflight to deduplicate concurrent HTTP fetches.
func (c *SimpleJWKSCache) GetKey(ctx context.Context, kid string) (crypto.PublicKey, error) {
	c.mu.RLock()
	key, ok := c.keys[kid]
	c.mu.RUnlock()
	if ok {
		return key, nil
	}

	// Cache miss: coordinate fetch
	_, err, _ := c.group.Do("jwks_refresh", func() (interface{}, error) {
		// Re-check after acquiring singleflight
		c.mu.RLock()
		_, ok := c.keys[kid]
		cooldownActive := c.minRefreshInterval > 0 && !c.lastRefresh.IsZero() && time.Since(c.lastRefresh) < c.minRefreshInterval
		c.mu.RUnlock()

		if ok {
			return nil, nil // We have it now
		}
		if cooldownActive {
			return nil, nil // Do not fetch, hit cooldown
		}

		// Execute actual HTTP fetch and cache update
		return nil, c.ForceRefresh(ctx)
	})

	if err != nil {
		return nil, fmt.Errorf("failed to fetch JWKS: %w", err)
	}

	// Fetch or cooldown finished, check cache one final time
	c.mu.RLock()
	key, ok = c.keys[kid]
	c.mu.RUnlock()

	if !ok {
		return nil, ErrUnknownKeyID
	}
	return key, nil
}

// forceRefresh fetches the JWKS document and replaces the cache contents.
func (c *SimpleJWKSCache) ForceRefresh(ctx context.Context) error {
	// Step 1: Fetch the JWKS document from the user-service (outside lock)
	jwks, err := c.fetchFn(ctx, c.jwksURL)
	if err != nil {
		return err
	}

	// Step 2: Convert each JWK to a public key (outside lock)
	newKeys := make(map[string]crypto.PublicKey, len(jwks))
	for _, jwk := range jwks {
		pubKey, err := jwkToPublicKey(jwk)
		if err != nil {
			slog.Warn("skipping invalid JWKS key", "kid", jwk.Kid, "error", err)
			continue
		}
		newKeys[jwk.Kid] = pubKey
	}

	// Step 3: Acquire exclusive write lock and atomically swap
	c.mu.Lock()
	c.keys = newKeys
	c.lastRefresh = time.Now()
	c.mu.Unlock()

	return nil
}

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
