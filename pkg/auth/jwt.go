package auth

import (
	"context"
	"crypto"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	issuer   = "galaxify-user-service"
	audience = "galaxify"
)

var AccessTokenLifetime = 15 * time.Minute

type Claims struct {
	jwt.RegisteredClaims
	Email string `json:"email"`
}

func IssueAccessToken(privKey crypto.PrivateKey, kid, userID, email string) (tokenString string, err error) {
	now := time.Now()

	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			Issuer:    issuer,
			Audience:  jwt.ClaimStrings{audience},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(AccessTokenLifetime)),
		},
		Email: email,
	})

	token.Header["kid"] = kid

	return token.SignedString(privKey)
}

func VerifyAccessToken(pubKey crypto.PublicKey, tokenString string) (claims *Claims, err error) {
	keyFunc := func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodEd25519); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return pubKey, nil
	}

	token, err := jwt.ParseWithClaims(
		tokenString,
		&Claims{},
		keyFunc,
		jwt.WithAudience(audience),
		jwt.WithIssuer(issuer),
	)

	if err != nil {
		return nil, err
	}

	if !token.Valid {
		return nil, errors.New("invalid token")
	}

	claims, ok := token.Claims.(*Claims)
	if !ok {
		return nil, errors.New("invalid claims")
	}

	return claims, nil
}

type JWK struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Kid string `json:"kid"`
	Use string `json:"use,omitempty"`
	Alg string `json:"alg,omitempty"`
}

func PublicKeyToJWK(pubKey crypto.PublicKey, kid string) (JWK, error) {
	edPub, ok := pubKey.(ed25519.PublicKey)

	if !ok {
		return JWK{}, errors.New("not an Ed25519 key")
	}

	return JWK{
		Kty: "OKP",
		Crv: "Ed25519",
		X:   base64.RawURLEncoding.EncodeToString(edPub),
		Kid: kid,
		Use: "sig",
		Alg: "EdDSA",
	}, nil
}

type jwksDocument struct {
	Keys []JWK `json:"keys"`
}

func FetchJWKS(ctx context.Context, jwksURL string) ([]JWK, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, jwksURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch JWKS: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch JWKS: status code %d", resp.StatusCode)
	}

	var jwks jwksDocument
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, fmt.Errorf("failed to decode JWKS: %w", err)
	}

	return jwks.Keys, nil
}
