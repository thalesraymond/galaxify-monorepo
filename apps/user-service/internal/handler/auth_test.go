package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// fakeTx records commit/rollback so handler tests can assert transaction use.
type fakeTx struct {
	pgx.Tx
	committed  bool
	rolledBack bool
}

func (f *fakeTx) Commit(context.Context) error {
	f.committed = true
	return nil
}

func (f *fakeTx) Rollback(context.Context) error {
	f.rolledBack = true
	return nil
}

// fakeTxStarter hands out a single fakeTx so tests can inspect it.
type fakeTxStarter struct {
	tx *fakeTx
}

func (f *fakeTxStarter) Begin(context.Context) (pgx.Tx, error) {
	if f.tx == nil {
		f.tx = &fakeTx{}
	}
	return f.tx, nil
}

func newTestRequest(t *testing.T, method, target, body string) *http.Request {
	t.Helper()
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	return req
}

func wantStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Errorf("status = %d, want %d", rec.Code, want)
	}
}

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.NewDecoder(rec.Body).Decode(v); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
}

func wantErrorCode(t *testing.T, rec *httptest.ResponseRecorder, want string) {
	t.Helper()
	var resp sharedhttp.ErrorResponse
	decodeBody(t, rec, &resp)
	if resp.Error.Code != want {
		t.Errorf("error code = %q, want %q", resp.Error.Code, want)
	}
}

func wantFieldError(t *testing.T, rec *httptest.ResponseRecorder, field, wantMessage string) {
	t.Helper()
	var resp sharedhttp.ErrorResponse
	decodeBody(t, rec, &resp)
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
