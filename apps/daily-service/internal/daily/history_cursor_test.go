package daily

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestHistoryCursorRoundTrip(t *testing.T) {
	original := HistoryCursor{
		DueDate:    time.Date(2026, 9, 15, 10, 30, 0, 123456000, time.UTC),
		ArchivedAt: time.Date(2026, 9, 15, 11, 0, 1, 500000000, time.UTC),
		ID:         uuid.MustParse("6ba7b810-9dad-11d1-80b4-00c04fd430c8"),
	}

	token := encodeHistoryCursor(original)
	if token == "" {
		t.Fatalf("encodeHistoryCursor() returned an empty token")
	}

	decoded, err := decodeHistoryCursor(token)
	if err != nil {
		t.Fatalf("decodeHistoryCursor() error = %v", err)
	}
	if !decoded.DueDate.Equal(original.DueDate) {
		t.Errorf("DueDate = %v, want %v", decoded.DueDate, original.DueDate)
	}
	if !decoded.ArchivedAt.Equal(original.ArchivedAt) {
		t.Errorf("ArchivedAt = %v, want %v", decoded.ArchivedAt, original.ArchivedAt)
	}
	if decoded.ID != original.ID {
		t.Errorf("ID = %v, want %v", decoded.ID, original.ID)
	}
}

func TestDecodeHistoryCursorRejectsTamperedTokens(t *testing.T) {
	valid := encodeHistoryCursor(HistoryCursor{
		DueDate:    time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC),
		ArchivedAt: time.Date(2026, 9, 15, 11, 0, 0, 0, time.UTC),
		ID:         uuid.New(),
	})

	encodeRaw := func(value any) string {
		payload, err := json.Marshal(value)
		if err != nil {
			t.Fatalf("marshal payload: %v", err)
		}
		return base64.RawURLEncoding.EncodeToString(payload)
	}

	tests := []struct {
		name  string
		token string
	}{
		{name: "empty", token: ""},
		{name: "not base64", token: "!!!not-base64!!!"},
		{name: "not json", token: base64.RawURLEncoding.EncodeToString([]byte("hello"))},
		{name: "wrong version", token: encodeRaw(map[string]any{"v": 2, "d": "2026-09-15T10:00:00Z", "a": "2026-09-15T11:00:00Z", "i": uuid.New().String()})},
		{name: "unknown field", token: encodeRaw(map[string]any{"v": 1, "d": "2026-09-15T10:00:00Z", "a": "2026-09-15T11:00:00Z", "i": uuid.New().String(), "x": "extra"})},
		{name: "invalid due date", token: encodeRaw(map[string]any{"v": 1, "d": "not-a-time", "a": "2026-09-15T11:00:00Z", "i": uuid.New().String()})},
		{name: "invalid archived at", token: encodeRaw(map[string]any{"v": 1, "d": "2026-09-15T10:00:00Z", "a": "not-a-time", "i": uuid.New().String()})},
		{name: "invalid id", token: encodeRaw(map[string]any{"v": 1, "d": "2026-09-15T10:00:00Z", "a": "2026-09-15T11:00:00Z", "i": "not-a-uuid"})},
		{name: "trailing data", token: base64.RawURLEncoding.EncodeToString([]byte(mustJSONString(t, valid) + "{}"))},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := decodeHistoryCursor(tt.token); !errors.Is(err, ErrInvalidHistoryCursor) {
				t.Fatalf("decodeHistoryCursor() error = %v, want ErrInvalidHistoryCursor", err)
			}
		})
	}
}

func TestEncodeHistoryCursorIsOpaque(t *testing.T) {
	cursor := HistoryCursor{
		DueDate:    time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC),
		ArchivedAt: time.Date(2026, 9, 15, 11, 0, 0, 0, time.UTC),
		ID:         uuid.MustParse("6ba7b810-9dad-11d1-80b4-00c04fd430c8"),
	}
	token := encodeHistoryCursor(cursor)
	if strings.Contains(token, cursor.ID.String()) {
		t.Errorf("token %q leaks the raw id", token)
	}
	if strings.ContainsAny(token, "+/=") {
		t.Errorf("token %q is not URL-safe base64", token)
	}
}

func mustJSONString(t *testing.T, token string) string {
	t.Helper()
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		t.Fatalf("decode valid token: %v", err)
	}
	return string(decoded)
}
