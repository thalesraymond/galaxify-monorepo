package auth

import (
	"crypto"
	"errors"
	"fmt"
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
