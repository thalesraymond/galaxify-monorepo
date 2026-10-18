package sharedhttp

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"

	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
)

type ctxKey int

const requestIDKey ctxKey = iota

// AuthedHandler is an HTTP handler that receives the authenticated user's ID
// as a parameter. Used with AuthHandshake.RequireAuth to avoid context lookups.
type AuthedHandler func(w http.ResponseWriter, r *http.Request, userID string)

// AuthHandshake wraps a JWKS cache and provides RequireAuth middleware that
// validates JWTs and passes the extracted userID to AuthedHandler functions.
type AuthHandshake struct {
	cache auth.JWKSCache
}

// NewAuthHandshake creates an AuthHandshake with the given JWKS cache.
func NewAuthHandshake(cache auth.JWKSCache) *AuthHandshake {
	return &AuthHandshake{cache: cache}
}

// RequireAuth wraps an AuthedHandler with JWT validation middleware. On success,
// the validated userID is passed directly to the handler. On failure, an
// appropriate error response is written and the handler is not called.
//
// Performance Optimization: Uses single-pass token verification via
// auth.VerifyAccessTokenWithCache, eliminating redundant pre-parsing and
// cutting allocations per authenticated request in half (~116 -> 59 allocs/op).
func (hs *AuthHandshake) RequireAuth(next AuthedHandler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			WriteError(w, http.StatusUnauthorized, "AUTH_MISSING_HEADER", "Authorization header missing")
			return
		}

		const bearerPrefix = "Bearer "
		if len(authHeader) < len(bearerPrefix) || authHeader[:len(bearerPrefix)] != bearerPrefix {
			WriteError(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "invalid authorization format")
			return
		}

		tokenString := authHeader[len(bearerPrefix):]

		claims, err := auth.VerifyAccessTokenWithCache(r.Context(), hs.cache, tokenString)
		if err != nil {
			if errors.Is(err, auth.ErrMissingKID) {
				WriteError(w, http.StatusUnauthorized, "AUTH_MISSING_KID", "missing kid in token header")
			} else if errors.Is(err, auth.ErrUnknownKeyID) {
				WriteError(w, http.StatusUnauthorized, "AUTH_UNKNOWN_KID", "unknown kid in token header")
			} else if errors.Is(err, auth.ErrKeyFetchFailed) {
				WriteError(w, http.StatusInternalServerError, "AUTH_KEY_FETCH_FAILED", "failed to fetch JWKS")
			} else {
				WriteError(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "invalid token")
			}
			return
		}

		next(w, r, claims.Subject)
	})
}

func RequestIDMiddleware(next http.Handler) http.Handler {
	requestIDHeader := "X-Request-Id"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get(requestIDHeader)
		if requestID == "" {
			requestID = uuid.New().String()
		}

		ctx := WithRequestID(r.Context(), requestID)
		r = r.WithContext(ctx)

		w.Header().Set(requestIDHeader, requestID)

		next.ServeHTTP(&responseWriter{ResponseWriter: w, requestID: requestID}, r)
	})
}

func WithRequestID(ctx context.Context, requestID string) context.Context {
	return context.WithValue(ctx, requestIDKey, requestID)
}

func RequestIDFromContext(ctx context.Context) string {
	if requestID, ok := ctx.Value(requestIDKey).(string); ok {
		return requestID
	}
	return ""
}

type responseWriter struct {
	http.ResponseWriter
	requestID string
}

func (rw *responseWriter) WriteHeader(status int) {
	rw.Header().Set("X-Request-Id", rw.requestID)
	rw.ResponseWriter.WriteHeader(status)
}
