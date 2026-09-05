package sharedhttp

import (
	"context"
	"net/http"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"
)

type ctxKey int

const (
	requestIDKey ctxKey = iota
	userIDKey
)

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

func RequireAuth(cache auth.JWKSCache) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
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

			// Extract bearer token from the Authorization header
			tokenString := authHeader[len(bearerPrefix):]

			parser := jwt.NewParser()
			token, _, err := parser.ParseUnverified(tokenString, &auth.Claims{})

			if err != nil {
				WriteError(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "invalid token")
				return
			}

			kid, ok := token.Header["kid"].(string)
			if !ok {
				WriteError(w, http.StatusUnauthorized, "AUTH_MISSING_KID", "missing kid in token header")
				return
			}

			pubKey, found := cache.GetKey(kid)
			if !found {
				if err := cache.ForceRefresh(r.Context()); err != nil {
					WriteError(w, http.StatusInternalServerError, "AUTH_KEY_FETCH_FAILED", "failed to fetch JWKS")
					return
				}
				pubKey, found = cache.GetKey(kid)
				if !found {
					WriteError(w, http.StatusUnauthorized, "AUTH_UNKNOWN_KID", "unknown kid in token header")
					return
				}
			}

			claims, err := auth.VerifyAccessToken(pubKey, tokenString)
			if err != nil {
				WriteError(w, http.StatusUnauthorized, "AUTH_INVALID_TOKEN", "invalid token")
				return
			}

			ctx := context.WithValue(r.Context(), userIDKey, claims.Subject)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func UserIDFromContext(ctx context.Context) string {
	if userID, ok := ctx.Value(userIDKey).(string); ok {
		return userID
	}
	return ""
}

// WithUserID returns a copy of ctx with the given userID stored under the
// same key used by RequireAuth. Exported for tests that need to simulate an
// authenticated request without going through the JWT middleware.
func WithUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, userIDKey, userID)
}
