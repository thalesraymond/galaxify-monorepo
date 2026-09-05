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

// rotateStore is the narrow DB surface needed for family-based token rotation.
// It is satisfied by *database.Queries in production.
type rotateStore interface {
	GetRefreshTokenByToken(ctx context.Context, token string) (database.RefreshToken, error)
	MarkRefreshTokenUsed(ctx context.Context, id int64) error
	DeleteRefreshTokensByFamilyID(ctx context.Context, familyID pgtype.UUID) error
	InsertRefreshToken(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error)
}

// RotateSession implements pkg/auth.RefreshTokenStore.Rotate.
// It validates presentedToken against the DB, enforces family-based
// reuse detection, and — on success — marks the old token used, inserts a new
// token in the same family, and returns the new token + userID.
//
// Callers (SessionHandler.Refresh) use userID to look up the user's email and
// then call IssueAccessToken directly so they can build the full HTTP response.
func (ti *TokenIssuer) RotateSession(ctx context.Context, rs rotateStore, presentedToken string) (newToken string, userID pgtype.UUID, err error) {
	row, err := rs.GetRefreshTokenByToken(ctx, presentedToken)
	if err != nil {
		// Not found (pgx.ErrNoRows) or any DB error → invalid token.
		return "", pgtype.UUID{}, auth.ErrInvalidRefreshToken
	}

	// Reuse detected: token already consumed → nuke the whole family.
	if row.Used {
		_ = rs.DeleteRefreshTokensByFamilyID(ctx, row.FamilyID)
		return "", pgtype.UUID{}, auth.ErrInvalidRefreshToken
	}

	// Expired.
	if row.ExpiresAt.Valid && time.Now().After(row.ExpiresAt.Time) {
		return "", pgtype.UUID{}, auth.ErrInvalidRefreshToken
	}

	// Valid — rotate.
	if err := rs.MarkRefreshTokenUsed(ctx, row.ID); err != nil {
		return "", pgtype.UUID{}, err
	}

	newRawToken, _, err := generateNewRefreshToken()
	if err != nil {
		return "", pgtype.UUID{}, err
	}

	_, err = rs.InsertRefreshToken(ctx, database.InsertRefreshTokenParams{
		UserID:    row.UserID,
		Token:     newRawToken,
		FamilyID:  row.FamilyID,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(7 * 24 * time.Hour), Valid: true},
	})
	if err != nil {
		return "", pgtype.UUID{}, err
	}

	return newRawToken, row.UserID, nil
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

// generateNewRefreshToken creates a single opaque refresh token (no new
// family; rotation reuses the existing family_id from the old token row).
func generateNewRefreshToken() (token string, _ struct{}, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", struct{}{}, err
	}
	return base64.RawURLEncoding.EncodeToString(b), struct{}{}, nil
}
