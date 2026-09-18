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

	"github.com/thalesraymond/galaxify-monorepo/apps/expedition-service/internal/expedition"
)

// TestExpeditionReadHandler_TimestampFormat verifies that the expedition-service
// returns timestamps with the 'Z' suffix (UTC) rather than numeric timezone offsets.
//
// This is a regression test for a bug where the frontend zod schema rejected
// valid expedition responses because the API returned timestamps like
// "2026-01-15T09:00:00.123456789+00:00" instead of "2026-01-15T09:00:00.123456789Z".
//
// The bug occurred when PostgreSQL returned a timestamptz and the service
// timezone was not UTC, causing time.Time to have a non-UTC location.
// Go's time.RFC3339Nano format then produced numeric offsets instead of 'Z'.
//
// The fix: call .UTC() before formatting to ensure consistent 'Z' suffix.
func TestExpeditionReadHandler_TimestampFormat(t *testing.T) {
	userID := uuid.New()
	expeditionID := uuid.New()

	// Simulate what pgx might return: times with non-UTC locations
	// This reproduces the bug condition where the database returns timestamps
	// with timezone offsets (e.g., when the PostgreSQL session timezone is not UTC)
	nonUTCLocation := time.FixedZone("test-zone", -5*3600) // UTC-5
	resolveAt := time.Date(2026, 1, 15, 9, 0, 0, 123456789, nonUTCLocation)
	createdAt := time.Date(2026, 1, 15, 8, 0, 0, 0, nonUTCLocation)

	record := expedition.Record{
		ID:                expeditionID,
		UserID:            userID,
		MaterialsInvested: 10,
		SuccessChance:     0.75,
		ResolveAt:         resolveAt,
		Status:            "IN_PROGRESS",
		CreatedAt:         createdAt,
		ResolvedAt:        nil,
		Result:            nil,
	}

	manager := &mockExpeditionManager{
		current: func(_ context.Context, gotUserID uuid.UUID) (expedition.Record, error) {
			if gotUserID != userID {
				t.Errorf("Current userID = %v, want %v", gotUserID, userID)
			}
			return record, nil
		},
	}

	router, signer := newTestExpeditionReadRouter(t, manager)
	req := httptest.NewRequest(http.MethodGet, "/expeditions/current", nil)
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

	// Check resolve_at
	resolveAtStr, ok := response["resolve_at"].(string)
	if !ok {
		t.Fatalf("resolve_at is not a string: %v", response["resolve_at"])
	}
	if !strings.HasSuffix(resolveAtStr, "Z") {
		t.Errorf("resolve_at must end with 'Z' (UTC), got: %s", resolveAtStr)
	}

	// Check created_at
	createdAtStr, ok := response["created_at"].(string)
	if !ok {
		t.Fatalf("created_at is not a string: %v", response["created_at"])
	}
	if !strings.HasSuffix(createdAtStr, "Z") {
		t.Errorf("created_at must end with 'Z' (UTC), got: %s", createdAtStr)
	}

	// Verify timestamps are correctly converted to UTC
	// resolve_at was 09:00:00 in UTC-5, so UTC should be 14:00:00
	if !strings.Contains(resolveAtStr, "T14:00:00") {
		t.Errorf("resolve_at should be converted to UTC (14:00:00), got: %s", resolveAtStr)
	}
	// created_at was 08:00:00 in UTC-5, so UTC should be 13:00:00
	if !strings.Contains(createdAtStr, "T13:00:00") {
		t.Errorf("created_at should be converted to UTC (13:00:00), got: %s", createdAtStr)
	}
}
