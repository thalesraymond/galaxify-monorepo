package sharedhttp

import (
	"net/http"

	"github.com/google/uuid"

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

func RequireAuth(cache JWKSCache) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		})
	}
}
