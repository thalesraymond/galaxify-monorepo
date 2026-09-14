// Package session owns refresh-token rotation and family revocation.
package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
)

var ErrInvalidRefreshToken = errors.New("invalid refresh token")

// Rotation is the replacement credential and identity required to mint a new
// access token after a successful refresh-token rotation.
type Rotation struct {
	RefreshToken string
	UserID       pgtype.UUID
	Email        string
}

// Manager is the session lifecycle boundary used by the HTTP handler.
type Manager interface {
	Rotate(ctx context.Context, presentedToken string) (Rotation, error)
	Logout(ctx context.Context, presentedToken string) error
}

type TxStarter interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

type Store interface {
	GetRefreshTokenByTokenForUpdate(ctx context.Context, token string) (database.RefreshToken, error)
	MarkRefreshTokenUsed(ctx context.Context, id int64) error
	InsertRefreshToken(ctx context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error)
	DeleteRefreshTokensByFamilyID(ctx context.Context, familyID pgtype.UUID) error
	GetUserByID(ctx context.Context, id pgtype.UUID) (database.User, error)
}

type ManagerStoreFactory func(pgx.Tx) Store

type manager struct {
	txStarter TxStarter
	newStore  ManagerStoreFactory
}

func NewManager(txStarter TxStarter, newStore ManagerStoreFactory) Manager {
	return &manager{txStarter: txStarter, newStore: newStore}
}

func (m *manager) Rotate(ctx context.Context, presentedToken string) (rotation Rotation, err error) {
	newToken, err := generateRefreshToken()
	if err != nil {
		return Rotation{}, fmt.Errorf("generate replacement refresh token: %w", err)
	}

	tx, err := m.txStarter.Begin(ctx)
	if err != nil {
		return Rotation{}, fmt.Errorf("begin refresh rotation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	store := m.newStore(tx)
	row, err := store.GetRefreshTokenByTokenForUpdate(ctx, presentedToken)
	if errors.Is(err, pgx.ErrNoRows) {
		return Rotation{}, ErrInvalidRefreshToken
	}
	if err != nil {
		return Rotation{}, fmt.Errorf("lock refresh token: %w", err)
	}

	if row.Used {
		if err := store.DeleteRefreshTokensByFamilyID(ctx, row.FamilyID); err != nil {
			return Rotation{}, fmt.Errorf("revoke reused refresh-token family: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return Rotation{}, fmt.Errorf("commit refresh-token family revocation: %w", err)
		}
		return Rotation{}, ErrInvalidRefreshToken
	}
	if !row.ExpiresAt.Valid || !time.Now().Before(row.ExpiresAt.Time) {
		return Rotation{}, ErrInvalidRefreshToken
	}

	if err := store.MarkRefreshTokenUsed(ctx, row.ID); err != nil {
		return Rotation{}, fmt.Errorf("consume refresh token: %w", err)
	}
	if _, err := store.InsertRefreshToken(ctx, database.InsertRefreshTokenParams{
		UserID: row.UserID, Token: newToken, FamilyID: row.FamilyID,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(7 * 24 * time.Hour), Valid: true},
	}); err != nil {
		return Rotation{}, fmt.Errorf("store replacement refresh token: %w", err)
	}
	user, err := store.GetUserByID(ctx, row.UserID)
	if err != nil {
		return Rotation{}, fmt.Errorf("look up refresh-token user: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Rotation{}, fmt.Errorf("commit refresh rotation: %w", err)
	}
	return Rotation{RefreshToken: newToken, UserID: row.UserID, Email: user.Email}, nil
}

// Logout revokes the presented token's family without revealing whether it was
// ever present. It serializes with Rotate through the same row lock.
func (m *manager) Logout(ctx context.Context, presentedToken string) error {
	tx, err := m.txStarter.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin logout: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	store := m.newStore(tx)
	row, err := store.GetRefreshTokenByTokenForUpdate(ctx, presentedToken)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("lock logout refresh token: %w", err)
	}
	if err := store.DeleteRefreshTokensByFamilyID(ctx, row.FamilyID); err != nil {
		return fmt.Errorf("revoke refresh-token family: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit logout: %w", err)
	}
	return nil
}

func generateRefreshToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
