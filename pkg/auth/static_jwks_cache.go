package auth

import (
	"context"
	"crypto"
)

// StaticJWKSCache is a JWKSCache that holds a single pre-populated key.
// It is used by user-service itself, which owns the signing key and does not
// need to fetch it from a remote JWKS endpoint.
type StaticJWKSCache struct {
	kid    string
	pubKey crypto.PublicKey
}

// NewStaticJWKSCache creates a cache pre-populated with the given key.
func NewStaticJWKSCache(kid string, pubKey crypto.PublicKey) *StaticJWKSCache {
	return &StaticJWKSCache{kid: kid, pubKey: pubKey}
}

// GetKey returns the public key if the requested kid matches the one this
// cache was created with.
func (c *StaticJWKSCache) GetKey(ctx context.Context, kid string) (crypto.PublicKey, error) {
	if kid == c.kid {
		return c.pubKey, nil
	}
	return nil, ErrUnknownKeyID
}


