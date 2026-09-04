package handler

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
)

type mockRefreshTokenStore struct {
	insertRefreshToken func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error)
}

func (m *mockRefreshTokenStore) InsertRefreshToken(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
	if m.insertRefreshToken != nil {
		return m.insertRefreshToken(ctx, arg)
	}
	return database.RefreshToken{}, errors.New("unexpected InsertRefreshToken call")
}

func newTestTokenIssuer(t *testing.T, store refreshTokenStore) *TokenIssuer {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return NewTokenIssuer(priv, "test-key", store)
}

func TestIssueSession(t *testing.T) {
	userID := pgtype.UUID{Bytes: uuid.New(), Valid: true}

	store := &mockRefreshTokenStore{
		insertRefreshToken: func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
			if arg.UserID != userID {
				t.Errorf("user_id mismatch")
			}
			if arg.Token == "" {
				t.Error("refresh token is empty")
			}
			if !arg.FamilyID.Valid {
				t.Error("family_id is invalid")
			}
			if !arg.ExpiresAt.Valid {
				t.Error("expires_at is invalid")
			}
			return database.RefreshToken{}, nil
		},
	}

	issuer := newTestTokenIssuer(t, store)
	accessToken, refreshToken, err := issuer.IssueSession(context.Background(), userID, "user@example.com")
	if err != nil {
		t.Fatalf("issue session: %v", err)
	}
	if accessToken == "" {
		t.Error("access_token is empty")
	}
	if refreshToken == "" {
		t.Error("refresh_token is empty")
	}
}

func TestIssueSessionAccessTokenIsValid(t *testing.T) {
	userID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	store := &mockRefreshTokenStore{
		insertRefreshToken: func(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
			return database.RefreshToken{}, nil
		},
	}

	issuer := newTestTokenIssuer(t, store)
	accessToken, _, err := issuer.IssueSession(context.Background(), userID, "user@example.com")
	if err != nil {
		t.Fatalf("issue session: %v", err)
	}

	claims, err := auth.VerifyAccessToken(issuer.privateKey.Public(), accessToken)
	if err != nil {
		t.Fatalf("verify access token: %v", err)
	}
	if claims.Subject != uuid.UUID(userID.Bytes).String() {
		t.Errorf("subject = %q, want %q", claims.Subject, uuid.UUID(userID.Bytes).String())
	}
	if claims.Email != "user@example.com" {
		t.Errorf("email claim = %q, want user@example.com", claims.Email)
	}
}
