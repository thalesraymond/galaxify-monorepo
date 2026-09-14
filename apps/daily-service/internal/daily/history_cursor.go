package daily

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"time"

	"github.com/google/uuid"
)

// historyCursorVersion is bumped whenever the encoded shape changes so stale
// tokens are rejected as invalid rather than silently misread.
const historyCursorVersion = 1

// historyCursorPayload is the private representation of a HistoryCursor. It is
// base64url-encoded so clients treat the token as opaque and cannot build one
// by hand.
type historyCursorPayload struct {
	Version    int    `json:"v"`
	DueDate    string `json:"d"`
	ArchivedAt string `json:"a"`
	ID         string `json:"i"`
}

// encodeHistoryCursor renders a cursor as an opaque, URL-safe token.
func encodeHistoryCursor(cursor HistoryCursor) string {
	payload := historyCursorPayload{
		Version:    historyCursorVersion,
		DueDate:    cursor.DueDate.UTC().Format(time.RFC3339Nano),
		ArchivedAt: cursor.ArchivedAt.UTC().Format(time.RFC3339Nano),
		ID:         cursor.ID.String(),
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		// HistoryCursor carries only JSON-marshalable scalars, so this is
		// unreachable; fall back to an empty token instead of panicking.
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(encoded)
}

// decodeHistoryCursor parses an opaque token produced by encodeHistoryCursor.
// Every malformed, tampered, or unsupported token collapses to
// ErrInvalidHistoryCursor so callers cannot distinguish encoding details.
func decodeHistoryCursor(raw string) (HistoryCursor, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return HistoryCursor{}, ErrInvalidHistoryCursor
	}

	var payload historyCursorPayload
	decoder := json.NewDecoder(bytes.NewReader(decoded))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return HistoryCursor{}, ErrInvalidHistoryCursor
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return HistoryCursor{}, ErrInvalidHistoryCursor
	}
	if payload.Version != historyCursorVersion {
		return HistoryCursor{}, ErrInvalidHistoryCursor
	}

	dueDate, err := time.Parse(time.RFC3339Nano, payload.DueDate)
	if err != nil {
		return HistoryCursor{}, ErrInvalidHistoryCursor
	}
	archivedAt, err := time.Parse(time.RFC3339Nano, payload.ArchivedAt)
	if err != nil {
		return HistoryCursor{}, ErrInvalidHistoryCursor
	}
	id, err := uuid.Parse(payload.ID)
	if err != nil {
		return HistoryCursor{}, ErrInvalidHistoryCursor
	}

	return HistoryCursor{DueDate: dueDate, ArchivedAt: archivedAt, ID: id}, nil
}
