package httperr

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWriteError(t *testing.T) {
	rec := httptest.NewRecorder()

	WriteError(rec, http.StatusNotFound, "DAILY_NOT_FOUND", "Daily task not found")

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}

	var got ErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if got.Error.Code != "DAILY_NOT_FOUND" {
		t.Errorf("code = %q, want %q", got.Error.Code, "DAILY_NOT_FOUND")
	}
	if got.Error.Message != "Daily task not found" {
		t.Errorf("message = %q, want %q", got.Error.Message, "Daily task not found")
	}
	if got.Error.Details != nil {
		t.Errorf("details = %v, want nil", got.Error.Details)
	}
}

func TestWriteValidationError(t *testing.T) {
	rec := httptest.NewRecorder()

	WriteValidationError(rec, map[string]string{
		"title":      "is required",
		"difficulty": "must be one of: EASY, MEDIUM, HARD",
	})

	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnprocessableEntity)
	}

	var got ErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if got.Error.Code != "VALIDATION_FAILED" {
		t.Errorf("code = %q, want %q", got.Error.Code, "VALIDATION_FAILED")
	}
	if got.Error.Message != "request validation failed" {
		t.Errorf("message = %q, want %q", got.Error.Message, "request validation failed")
	}
	if got.Error.Details == nil {
		t.Fatal("details = nil, want field_errors")
	}
	if got.Error.Details.FieldErrors["title"] != "is required" {
		t.Errorf("field_errors[title] = %q, want %q", got.Error.Details.FieldErrors["title"], "is required")
	}
	if got.Error.Details.FieldErrors["difficulty"] != "must be one of: EASY, MEDIUM, HARD" {
		t.Errorf("field_errors[difficulty] = %q, want %q", got.Error.Details.FieldErrors["difficulty"], "must be one of: EASY, MEDIUM, HARD")
	}
}

func TestWriteInternal(t *testing.T) {
	var logBuf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuf, nil))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Request-Id", "req-123")
	rec := httptest.NewRecorder()

	WriteInternal(rec, req, http.ErrServerClosed, logger)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}

	var got ErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if got.Error.Code != "INTERNAL_ERROR" {
		t.Errorf("code = %q, want %q", got.Error.Code, "INTERNAL_ERROR")
	}
	if got.Error.Message != "An unexpected error occurred" {
		t.Errorf("message = %q, want %q", got.Error.Message, "An unexpected error occurred")
	}
	if got.Error.Details != nil {
		t.Errorf("details = %v, want nil", got.Error.Details)
	}

	logged := logBuf.String()
	if logged == "" {
		t.Error("underlying error was not logged")
	}
}
