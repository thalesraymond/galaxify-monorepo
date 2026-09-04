package handler

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
)

// refreshTokenStore is the narrow database surface used by TokenIssuer.
type refreshTokenStore interface {
	InsertRefreshToken(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error)
}

// TokenIssuer owns the session-token lifecycle: generating opaque refresh
// tokens, persisting them with a family ID, and issuing signed access tokens.
// It is used by both registration and session handlers so the token ritual is
// defined in exactly one place.
type TokenIssuer struct {
	privateKey ed25519.PrivateKey
	kid        string
	store      refreshTokenStore
}

// NewTokenIssuer creates a TokenIssuer bound to the active signing keypair.
func NewTokenIssuer(privateKey ed25519.PrivateKey, kid string, store refreshTokenStore) *TokenIssuer {
	return &TokenIssuer{
		privateKey: privateKey,
		kid:        kid,
		store:      store,
	}
}

// IssueSession creates a new refresh token family and a signed access token for
// the given user. The refresh token expires in 7 days.
func (ti *TokenIssuer) IssueSession(ctx context.Context, userID pgtype.UUID, email string) (accessToken, refreshToken string, err error) {
	refreshToken, familyID, err := generateRefreshTokenAndFamily()
	if err != nil {
		return "", "", err
	}

	_, err = ti.store.InsertRefreshToken(ctx, database.InsertRefreshTokenParams{
		UserID:    userID,
		Token:     refreshToken,
		FamilyID:  pgtype.UUID{Bytes: familyID, Valid: true},
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(7 * 24 * time.Hour), Valid: true},
	})
	if err != nil {
		return "", "", err
	}

	accessToken, err = auth.IssueAccessToken(ti.privateKey, ti.kid, pgUUIDToString(userID), email)
	if err != nil {
		return "", "", err
	}

	return accessToken, refreshToken, nil
}

// generateRefreshTokenAndFamily creates a new opaque refresh token and the
// family UUID that binds rotation/revocation together.
func generateRefreshTokenAndFamily() (token string, familyID uuid.UUID, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", uuid.UUID{}, err
	}
	token = base64.RawURLEncoding.EncodeToString(b)

	familyID = uuid.New()
	return token, familyID, nil
}
