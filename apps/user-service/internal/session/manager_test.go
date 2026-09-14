package session

import (
	"context"
	"encoding/base64"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
)

// memorySessionStore models the row lock supplied by SELECT FOR UPDATE. It lets
// this test exercise concurrent callers without requiring PostgreSQL.
type memorySessionStore struct {
	mu      sync.Mutex
	rowLock sync.Mutex
	row     database.RefreshToken
	family  map[string]database.RefreshToken
	deleted bool
}

func (s *memorySessionStore) GetRefreshTokenByTokenForUpdate(_ context.Context, token string) (database.RefreshToken, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.deleted || s.row.Token != token {
		return database.RefreshToken{}, pgx.ErrNoRows
	}
	return s.row, nil
}

func (s *memorySessionStore) MarkRefreshTokenUsed(_ context.Context, id int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.deleted || s.row.ID != id || s.row.Used {
		return errors.New("token was not available")
	}
	s.row.Used = true
	return nil
}

func (s *memorySessionStore) InsertRefreshToken(_ context.Context, arg database.InsertRefreshTokenParams) (database.RefreshToken, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.deleted {
		return database.RefreshToken{}, errors.New("family deleted")
	}
	s.family[arg.Token] = database.RefreshToken{Token: arg.Token, FamilyID: arg.FamilyID}
	return s.family[arg.Token], nil
}

func (s *memorySessionStore) DeleteRefreshTokensByFamilyID(_ context.Context, _ pgtype.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deleted = true
	s.family = map[string]database.RefreshToken{}
	return nil
}

func (s *memorySessionStore) GetUserByID(context.Context, pgtype.UUID) (database.User, error) {
	return database.User{Email: "user@example.com"}, nil
}

// noOpTx is sufficient because manager tests use an in-memory store; production
// transaction behavior is supplied by pgxpool and verified through the manager seam.
type noOpTx struct{ pgx.Tx }

func (noOpTx) Commit(context.Context) error   { return nil }
func (noOpTx) Rollback(context.Context) error { return nil }

type noOpStarter struct{}

func (noOpStarter) Begin(context.Context) (pgx.Tx, error) { return noOpTx{}, nil }

type memoryTx struct {
	pgx.Tx
	store  *memorySessionStore
	locked bool
	done   sync.Once
}

func (tx *memoryTx) Commit(context.Context) error {
	tx.release()
	return nil
}

func (tx *memoryTx) Rollback(context.Context) error {
	tx.release()
	return nil
}

func (tx *memoryTx) release() {
	tx.done.Do(func() {
		if tx.locked {
			tx.store.rowLock.Unlock()
		}
	})
}

type memoryStarter struct{ store *memorySessionStore }

func (s memoryStarter) Begin(context.Context) (pgx.Tx, error) { return &memoryTx{store: s.store}, nil }

type transactionStore struct {
	*memorySessionStore
	tx *memoryTx
}

func (s transactionStore) GetRefreshTokenByTokenForUpdate(ctx context.Context, token string) (database.RefreshToken, error) {
	s.tx.store.rowLock.Lock()
	s.tx.locked = true
	return s.memorySessionStore.GetRefreshTokenByTokenForUpdate(ctx, token)
}

func TestManagerRotateConcurrentReuseRevokesFamily(t *testing.T) {
	userID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	familyID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	store := &memorySessionStore{
		row:    database.RefreshToken{ID: 1, UserID: userID, Token: "presented", FamilyID: familyID, ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}},
		family: map[string]database.RefreshToken{"presented": {}},
	}
	manager := NewManager(memoryStarter{store: store}, func(tx pgx.Tx) Store {
		return transactionStore{memorySessionStore: store, tx: tx.(*memoryTx)}
	})

	results := make(chan error, 2)
	for range 2 {
		go func() {
			_, err := manager.Rotate(context.Background(), "presented")
			results <- err
		}()
	}
	var successes, invalid int
	for range 2 {
		err := <-results
		if err == nil {
			successes++
		} else if errors.Is(err, ErrInvalidRefreshToken) {
			invalid++
		} else {
			t.Fatalf("Rotate() error = %v", err)
		}
	}
	if successes != 1 || invalid != 1 {
		t.Fatalf("rotate results: successes=%d invalid=%d, want 1 each", successes, invalid)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if !store.deleted || len(store.family) != 0 {
		t.Fatal("reused token did not revoke the entire family")
	}
}

func TestManagerLookupFailureIsNotInvalid(t *testing.T) {
	manager := NewManager(noOpStarter{}, func(pgx.Tx) Store { return failingStore{} })
	_, err := manager.Rotate(context.Background(), "presented")
	if !errors.Is(err, ErrRefreshUnavailable) {
		t.Fatalf("Rotate() error = %v, want ErrRefreshUnavailable", err)
	}
}

func TestManagerRotateReturnsDomainUserID(t *testing.T) {
	userID := uuid.New()
	store := &memorySessionStore{
		row: database.RefreshToken{
			ID:        1,
			UserID:    pgtype.UUID{Bytes: userID, Valid: true},
			Token:     "presented",
			FamilyID:  pgtype.UUID{Bytes: uuid.New(), Valid: true},
			ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
		},
		family: map[string]database.RefreshToken{"presented": {}},
	}
	manager := NewManager(noOpStarter{}, func(pgx.Tx) Store { return store })

	rotation, err := manager.Rotate(context.Background(), "presented")
	if err != nil {
		t.Fatalf("Rotate() error = %v", err)
	}
	if rotation.UserID != userID {
		t.Errorf("Rotation.UserID = %s, want %s", rotation.UserID, userID)
	}
	if rotation.Email != "user@example.com" {
		t.Errorf("Rotation.Email = %q, want user@example.com", rotation.Email)
	}
	if rotation.RefreshToken == "" || rotation.RefreshToken == "presented" {
		t.Errorf("Rotation.RefreshToken = %q, want a fresh replacement", rotation.RefreshToken)
	}
}

func TestGenerateRefreshTokenIsOpaqueAndDistinct(t *testing.T) {
	seen := make(map[string]struct{}, 2)
	for range 2 {
		token, err := GenerateRefreshToken()
		if err != nil {
			t.Fatalf("GenerateRefreshToken() error = %v", err)
		}
		raw, err := base64.RawURLEncoding.DecodeString(token)
		if err != nil {
			t.Fatalf("GenerateRefreshToken() = %q is not base64url: %v", token, err)
		}
		if len(raw) != 32 {
			t.Errorf("GenerateRefreshToken() decodes to %d bytes, want 32", len(raw))
		}
		if _, dup := seen[token]; dup {
			t.Fatalf("GenerateRefreshToken() returned a duplicate: %q", token)
		}
		seen[token] = struct{}{}
	}
}

type failingStore struct{}

func (failingStore) GetRefreshTokenByTokenForUpdate(context.Context, string) (database.RefreshToken, error) {
	return database.RefreshToken{}, errors.New("database unavailable")
}
func (failingStore) MarkRefreshTokenUsed(context.Context, int64) error { return nil }
func (failingStore) InsertRefreshToken(context.Context, database.InsertRefreshTokenParams) (database.RefreshToken, error) {
	return database.RefreshToken{}, nil
}
func (failingStore) DeleteRefreshTokensByFamilyID(context.Context, pgtype.UUID) error { return nil }
func (failingStore) GetUserByID(context.Context, pgtype.UUID) (database.User, error) {
	return database.User{}, nil
}
