// Package test provides shared HTTP handler test helpers for Galaxify services.
package test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// NewRequest builds an HTTP request for handler tests. It sets Content-Type to
// application/json when a body is present.
func NewRequest(t *testing.T, method, target, body string) *http.Request {
	t.Helper()
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	return req
}

// WantStatus asserts that the response status matches want.
func WantStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Errorf("status = %d, want %d", rec.Code, want)
	}
}

// DecodeBody decodes the JSON response body into v.
func DecodeBody(t *testing.T, rec *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.NewDecoder(rec.Body).Decode(v); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
}

// WantErrorCode asserts that the response contains an error envelope with the
// given code.
func WantErrorCode(t *testing.T, rec *httptest.ResponseRecorder, want string) {
	t.Helper()
	var resp sharedhttp.ErrorResponse
	DecodeBody(t, rec, &resp)
	if resp.Error.Code != want {
		t.Errorf("error code = %q, want %q", resp.Error.Code, want)
	}
}

// WantFieldError asserts that the response is a VALIDATION_FAILED envelope with
// the given field error.
func WantFieldError(t *testing.T, rec *httptest.ResponseRecorder, field, wantMessage string) {
	t.Helper()
	var resp sharedhttp.ErrorResponse
	DecodeBody(t, rec, &resp)
	if resp.Error.Code != "VALIDATION_FAILED" {
		t.Errorf("error code = %q, want VALIDATION_FAILED", resp.Error.Code)
	}
	if resp.Error.Details == nil {
		t.Fatalf("expected field errors, got none")
	}
	got, ok := resp.Error.Details.FieldErrors[field]
	if !ok {
		t.Fatalf("missing field error for %q", field)
	}
	if got != wantMessage {
		t.Errorf("field error for %q = %q, want %q", field, got, wantMessage)
	}
}
