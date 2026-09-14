// Package session owns refresh-token rotation and family revocation.
package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
)

var (
	ErrInvalidRefreshToken = errors.New("invalid refresh token")
	ErrRefreshUnavailable  = errors.New("refresh service unavailable")
)

// Rotation is the replacement credential and identity required to mint a new
// access token after a successful refresh-token rotation.
type Rotation struct {
	RefreshToken string
	UserID       uuid.UUID
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
	newToken, err := GenerateRefreshToken()
	if err != nil {
		return Rotation{}, fmt.Errorf("generate replacement refresh token: %w", err)
	}

	tx, err := m.txStarter.Begin(ctx)
	if err != nil {
		return Rotation{}, refreshUnavailable("begin refresh rotation", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	store := m.newStore(tx)
	row, err := store.GetRefreshTokenByTokenForUpdate(ctx, presentedToken)
	if errors.Is(err, pgx.ErrNoRows) {
		return Rotation{}, ErrInvalidRefreshToken
	}
	if err != nil {
		return Rotation{}, refreshUnavailable("lock refresh token", err)
	}

	if row.Used {
		if err := store.DeleteRefreshTokensByFamilyID(ctx, row.FamilyID); err != nil {
			return Rotation{}, refreshUnavailable("revoke reused refresh-token family", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return Rotation{}, refreshUnavailable("commit refresh-token family revocation", err)
		}
		return Rotation{}, ErrInvalidRefreshToken
	}
	if !row.ExpiresAt.Valid || !time.Now().Before(row.ExpiresAt.Time) {
		return Rotation{}, ErrInvalidRefreshToken
	}

	if err := store.MarkRefreshTokenUsed(ctx, row.ID); err != nil {
		return Rotation{}, refreshUnavailable("consume refresh token", err)
	}
	if _, err := store.InsertRefreshToken(ctx, database.InsertRefreshTokenParams{
		UserID: row.UserID, Token: newToken, FamilyID: row.FamilyID,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(7 * 24 * time.Hour), Valid: true},
	}); err != nil {
		return Rotation{}, refreshUnavailable("store replacement refresh token", err)
	}
	user, err := store.GetUserByID(ctx, row.UserID)
	if err != nil {
		return Rotation{}, refreshUnavailable("look up refresh-token user", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Rotation{}, refreshUnavailable("commit refresh rotation", err)
	}
	return Rotation{RefreshToken: newToken, UserID: uuidFromPg(row.UserID), Email: user.Email}, nil
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

// GenerateRefreshToken creates an opaque 32-byte base64url refresh token.
func GenerateRefreshToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func refreshUnavailable(operation string, err error) error {
	return fmt.Errorf("%w: %s: %w", ErrRefreshUnavailable, operation, err)
}

// uuidFromPg converts a database UUID into the domain's standard uuid.UUID at
// the store boundary, keeping pgtype out of the Rotation type.
func uuidFromPg(id pgtype.UUID) uuid.UUID {
	return uuid.UUID(id.Bytes)
}
