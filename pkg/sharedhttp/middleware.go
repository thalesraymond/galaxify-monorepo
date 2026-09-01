package sharedhttp

import (
	"net/http"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/thalesraymond/galaxify-monorepo/pkg/auth"

	"context"
)

type ctxKey int

const requestIDKey ctxKey = iota

func RequestIDMiddleware(next http.Handler) http.Handler {
	requestIDHeader := "X-Request-Id"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get(requestIDHeader)
		if requestID == "" {
			requestID = uuid.New().String()
		}

		ctx := context.WithValue(r.Context(), requestIDKey, requestID)
		r = r.WithContext(ctx)

		w.Header().Set(requestIDHeader, requestID)

		next.ServeHTTP(&responseWriter{ResponseWriter: w, requestID: requestID}, r)
	})
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

type contextKey string

const userIDKey contextKey = "userID"

func RequireAuth(cache auth.JWKSCache) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, "Authorization header missing", http.StatusUnauthorized)
				return
			}

			// Extract bearer token from the Authorization header
			tokenString := authHeader[len("Bearer "):]

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
