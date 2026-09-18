package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/ship"
)

// TestShipHandlerGetMe_TimestampFormat verifies that the ship-service returns
// timestamps with the 'Z' suffix (UTC) rather than numeric timezone offsets.
//
// This is a regression test for a bug where the frontend zod schema rejected
// valid ship responses because the API returned timestamps like
// "2026-01-15T09:00:00.123456789+00:00" instead of "2026-01-15T09:00:00.123456789Z".
//
// The bug occurred when PostgreSQL returned a timestamptz and the service
// timezone was not UTC, causing time.Time to have a non-UTC location.
// Go's time.RFC3339Nano format then produced numeric offsets instead of 'Z'.
//
// The fix: call .UTC() before formatting to ensure consistent 'Z' suffix.
func TestShipHandlerGetMe_TimestampFormat(t *testing.T) {
	userID := uuid.New()

	// Simulate what pgx might return: a time with a non-UTC location
	// This reproduces the bug condition where the database returns a timestamp
	// with a timezone offset (e.g., when the PostgreSQL session timezone is not UTC)
	nonUTCLocation := time.FixedZone("test-zone", -5*3600) // UTC-5
	updatedAt := time.Date(2026, 1, 15, 9, 0, 0, 123456789, nonUTCLocation)

	state := ship.State{
		UserID:           userID,
		HullHealth:       42,
		MaterialsBalance: 120,
		Level:            3,
		UpdatedAt:        updatedAt,
	}

	manager := &mockShipManager{
		get: func(_ context.Context, gotUserID uuid.UUID) (ship.State, error) {
			if gotUserID != userID {
				t.Errorf("Get userID = %v, want %v", gotUserID, userID)
			}
			return state, nil
		},
	}

	router, signer := newTestShipRouter(t, manager)
	req := httptest.NewRequest(http.MethodGet, "/ships/me", nil)
	req.Header.Set("Authorization", "Bearer "+signer.token(t, userID.String()))
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var response map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	updatedAtStr, ok := response["updated_at"].(string)
	if !ok {
		t.Fatalf("updated_at is not a string: %v", response["updated_at"])
	}

	// The timestamp must end with 'Z' (UTC), not a numeric offset like "+00:00"
	// This is required for the frontend zod schema (z.iso.datetime()) to accept it
	if !strings.HasSuffix(updatedAtStr, "Z") {
		t.Errorf("updated_at must end with 'Z' (UTC), got: %s", updatedAtStr)
		t.Errorf("The frontend zod parser rejects timestamps with numeric offsets")
		t.Errorf("Expected format: 2006-01-02T15:04:05.999999999Z")
	}

	// Verify the timestamp is correctly converted to UTC
	// The original time was 09:00:00 in UTC-5, so UTC should be 14:00:00
	if !strings.Contains(updatedAtStr, "T14:00:00") {
		t.Errorf("updated_at should be converted to UTC (14:00:00), got: %s", updatedAtStr)
	}
}
