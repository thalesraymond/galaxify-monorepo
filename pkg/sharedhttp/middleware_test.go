package sharedhttp

import (
	"context"
	"crypto"
	"crypto/ed25519"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
)

func TestRequestIDMiddleware(t *testing.T) {
	tests := []struct {
		name          string
		requestID     string // value of the X-Request-Id header; empty means absent
		wantForwarded bool   // true when a pre-existing ID must be preserved
	}{
		{
			name:      "generates a new request ID when header is absent",
			requestID: "",
		},
		{
			name:          "forwards a pre-existing request ID",
			requestID:     "req-123",
			wantForwarded: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotFromContext string
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotFromContext = RequestIDFromContext(r.Context())
				w.WriteHeader(http.StatusOK)
			})

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.requestID != "" {
				req.Header.Set("X-Request-Id", tt.requestID)
			}
			rec := httptest.NewRecorder()

			RequestIDMiddleware(next).ServeHTTP(rec, req)

			gotHeader := rec.Header().Get("X-Request-Id")

			if gotFromContext == "" {
				t.Error("request ID not populated in context")
			}
			if gotHeader == "" {
				t.Error("request ID not set on response header")
			}

			if tt.wantForwarded {
				if gotFromContext != tt.requestID {
					t.Errorf("context request ID = %q, want forwarded %q", gotFromContext, tt.requestID)
				}
				if gotHeader != tt.requestID {
					t.Errorf("response header request ID = %q, want forwarded %q", gotHeader, tt.requestID)
				}
				return
			}

			// Generated ID: must be a valid UUID and identical in context and header.
			if gotFromContext != gotHeader {
				t.Errorf("context request ID = %q, response header = %q, want them equal", gotFromContext, gotHeader)
			}
			if _, err := uuid.Parse(gotFromContext); err != nil {
				t.Errorf("generated request ID %q is not a valid UUID: %v", gotFromContext, err)
			}
		})
	}
}

// mockJWKSCache implements JWKSCache for testing
type mockJWKSCache struct {
	keys               map[string]ed25519.PublicKey
	forceRefreshCalled bool
}

func newMockJWKSCache() *mockJWKSCache {
	return &mockJWKSCache{
		keys: make(map[string]ed25519.PublicKey),
	}
}

func (m *mockJWKSCache) GetKey(kid string) (crypto.PublicKey, bool) {
	key, ok := m.keys[kid]
	return key, ok
}

func (m *mockJWKSCache) ForceRefresh(ctx context.Context) error {
	m.forceRefreshCalled = true
	return nil
}

func (m *mockJWKSCache) AddKey(kid string, key ed25519.PublicKey) {
	m.keys[kid] = key
}

func TestRequireAuth_MissingAuthorizationHeader(t *testing.T) {
	cache := newMockJWKSCache()
	handler := RequireAuth(cache)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	req := httptest.NewRequest("GET", "/protected", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestRequireAuth_MalformedBearerToken(t *testing.T) {
	tests := []struct {
		name       string
		authHeader string
	}{
		{name: "invalid format", authHeader: "InvalidFormat"},
		{name: "single char", authHeader: "B"},
		{name: "partial prefix", authHeader: "Bear"},
		{name: "prefix without trailing space", authHeader: "BearerToken"},
		{name: "empty bearer token", authHeader: "Bearer "},
		{name: "malformed token string", authHeader: "Bearer invalid-token-string"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cache := newMockJWKSCache()
			handler := RequireAuth(cache)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				t.Error("handler should not be called")
			}))

			req := httptest.NewRequest("GET", "/protected", nil)
			req.Header.Set("Authorization", tt.authHeader)
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
			}
		})
	}
}

func TestRequireAuth_ValidToken(t *testing.T) {
	// Generate test key
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	// Issue token
	tokenString, err := auth.IssueAccessToken(priv, "key-1", "user-123", "test@example.com")
	if err != nil {
		t.Fatal(err)
	}

	// Setup cache with the public key
	cache := newMockJWKSCache()
	cache.AddKey("key-1", priv.Public().(ed25519.PublicKey))

	// Track if handler was called
	handlerCalled := false
	handler := RequireAuth(cache)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		userID := UserIDFromContext(r.Context())
		if userID != "user-123" {
			t.Errorf("userID = %q, want user-123", userID)
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+tokenString)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !handlerCalled {
		t.Error("handler was not called")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestRequireAuth_ExpiredToken(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	// Issue token with zero lifetime
	oldLifetime := auth.AccessTokenLifetime
	auth.AccessTokenLifetime = 0
	defer func() { auth.AccessTokenLifetime = oldLifetime }()

	tokenString, err := auth.IssueAccessToken(priv, "key-1", "user-123", "test@example.com")
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(10 * time.Millisecond)

	cache := newMockJWKSCache()
	cache.AddKey("key-1", priv.Public().(ed25519.PublicKey))

	handler := RequireAuth(cache)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+tokenString)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestRequireAuth_UnknownKidForceRefresh(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	tokenString, err := auth.IssueAccessToken(priv, "key-1", "user-123", "test@example.com")
	if err != nil {
		t.Fatal(err)
	}

	cache := newMockJWKSCache()
	// Don't add the key - should trigger force refresh

	handler := RequireAuth(cache)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+tokenString)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !cache.forceRefreshCalled {
		t.Error("ForceRefresh was not called")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}
