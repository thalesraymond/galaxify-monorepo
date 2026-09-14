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
		ID:         uuid.MustParse("6ba7b810-9dad-11d1-80b4-00c04fd430c8"),
	})

	payloadOf := func(token string) string {
		payload, _, _ := strings.Cut(token, ".")
		return payload
	}
	macOf := func(token string) string {
		_, mac, _ := strings.Cut(token, ".")
		return mac
	}
	rawPayload := func(value any) string {
		payload, err := json.Marshal(value)
		if err != nil {
			t.Fatalf("marshal payload: %v", err)
		}
		return base64.RawURLEncoding.EncodeToString(payload)
	}
	// signedPayload builds a correctly signed token for an arbitrary payload so
	// the test exercises validation *after* the signature check, not the check
	// itself.
	signedPayload := func(value any) string {
		payload := rawPayload(value)
		return payload + "." + defaultHistoryCursorCodec.sign(payload)
	}
	validPayload := map[string]any{
		"v": 1,
		"d": "2026-09-15T10:00:00Z",
		"a": "2026-09-15T11:00:00Z",
		"i": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
	}

	tests := []struct {
		name  string
		token string
	}{
		{name: "empty", token: ""},
		{name: "not base64", token: "!!!not-base64!!!"},
		{name: "no signature", token: base64.RawURLEncoding.EncodeToString([]byte("hello"))},
		{name: "payload without mac", token: payloadOf(valid)},
		{name: "mac without payload", token: "." + macOf(valid)},
		{name: "unsigned raw payload", token: rawPayload(validPayload)},
		{
			name:  "tampered payload keeps stale mac",
			token: rawPayload(map[string]any{"v": 1, "d": validPayload["d"], "a": validPayload["a"], "i": uuid.New().String()}) + "." + macOf(valid),
		},
		{
			name: "signed with a different key",
			token: newHistoryCursorCodec([]byte("some-other-key")).
				encode(HistoryCursor{DueDate: time.Now(), ArchivedAt: time.Now(), ID: uuid.New()}),
		},
		{name: "wrong version", token: signedPayload(map[string]any{"v": 2, "d": validPayload["d"], "a": validPayload["a"], "i": validPayload["i"]})},
		{name: "unknown field", token: signedPayload(map[string]any{"v": 1, "d": validPayload["d"], "a": validPayload["a"], "i": validPayload["i"], "x": "extra"})},
		{name: "invalid due date", token: signedPayload(map[string]any{"v": 1, "d": "not-a-time", "a": validPayload["a"], "i": validPayload["i"]})},
		{name: "invalid archived at", token: signedPayload(map[string]any{"v": 1, "d": validPayload["d"], "a": "not-a-time", "i": validPayload["i"]})},
		{name: "invalid id", token: signedPayload(map[string]any{"v": 1, "d": validPayload["d"], "a": validPayload["a"], "i": "not-a-uuid"})},
		{name: "trailing data after payload", token: signedPayloadRaw(rawPayload(validPayload) + "{}")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := decodeHistoryCursor(tt.token); !errors.Is(err, ErrInvalidHistoryCursor) {
				t.Fatalf("decodeHistoryCursor() error = %v, want ErrInvalidHistoryCursor", err)
			}
		})
	}
}

// signedPayloadRaw signs an already-encoded raw payload string.
func signedPayloadRaw(payloadToken string) string {
	return payloadToken + "." + defaultHistoryCursorCodec.sign(payloadToken)
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
