package sharedhttp

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
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
