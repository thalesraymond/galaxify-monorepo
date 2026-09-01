package auth

import (
	"context"
	"testing"
)

// mockRefreshStore is a trivial in-memory implementation of RefreshTokenStore.
type mockRefreshStore struct {
	tokens map[string]string // presentedToken -> userID
}

func newMockRefreshStore() *mockRefreshStore {
	return &mockRefreshStore{tokens: make(map[string]string)}
}

func (m *mockRefreshStore) Rotate(_ context.Context, presentedToken string) (string, string, error) {
	uid, ok := m.tokens[presentedToken]
	if !ok {
		return "", "", ErrInvalidRefreshToken
	}
	delete(m.tokens, presentedToken)
	newToken := "new-token"
	m.tokens[newToken] = uid
	return newToken, uid, nil
}

// Compile-time check: mockRefreshStore satisfies RefreshTokenStore.
var _ RefreshTokenStore = (*mockRefreshStore)(nil)

func TestMockRefreshStore_Rotate(t *testing.T) {
	store := newMockRefreshStore()
	store.tokens["old-token"] = "user-42"

	ctx := context.Background()

	// Valid rotation.
	newTok, uid, err := store.Rotate(ctx, "old-token")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if uid != "user-42" {
		t.Fatalf("expected userID user-42, got %s", uid)
	}
	if newTok != "new-token" {
		t.Fatalf("expected new-token, got %s", newTok)
	}

	// Old token must be gone.
	_, _, err = store.Rotate(ctx, "old-token")
	if err != ErrInvalidRefreshToken {
		t.Fatalf("expected ErrInvalidRefreshToken for old token, got %v", err)
	}

	// New token must work.
	_, uid, err = store.Rotate(ctx, "new-token")
	if err != nil {
		t.Fatalf("unexpected error rotating new token: %v", err)
	}
	if uid != "user-42" {
		t.Fatalf("expected userID user-42, got %s", uid)
	}

	// Unknown token.
	_, _, err = store.Rotate(ctx, "does-not-exist")
	if err != ErrInvalidRefreshToken {
		t.Fatalf("expected ErrInvalidRefreshToken, got %v", err)
	}
}
