package daily

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
)

// historyCursorVersion is bumped whenever the encoded shape changes so stale
// tokens are rejected as invalid rather than silently misread.
const historyCursorVersion = 1

// defaultHistoryCursorSigningKey is the development fallback used when the
// service is not configured with HISTORY_CURSOR_SECRET. It keeps local runs and
// tests working; deployments must set a private secret so a client cannot mint
// valid cursors.
var defaultHistoryCursorSigningKey = []byte("galaxify-daily-history-cursor-dev-key")

// historyCursorPayload is the private representation of a HistoryCursor. It is
// base64url-encoded and HMAC-signed so clients treat the token as opaque and
// cannot build or edit one by hand.
type historyCursorPayload struct {
	Version    int    `json:"v"`
	DueDate    string `json:"d"`
	ArchivedAt string `json:"a"`
	ID         string `json:"i"`
}

// historyCursorCodec encodes and verifies opaque continuation tokens. The
// trailing MAC covers the encoded payload, so editing any field (or swapping in
// a different payload) invalidates the token and it is rejected as invalid
// rather than silently honouring a forged continuation point.
type historyCursorCodec struct {
	key []byte
}

func newHistoryCursorCodec(key []byte) historyCursorCodec {
	if len(key) == 0 {
		key = defaultHistoryCursorSigningKey
	}
	return historyCursorCodec{key: key}
}

// defaultHistoryCursorCodec backs the package-level helpers and any manager that
// is not given an explicit signing key.
var defaultHistoryCursorCodec = newHistoryCursorCodec(nil)

// encode renders a cursor as an opaque, URL-safe, tamper-evident token.
func (c historyCursorCodec) encode(cursor HistoryCursor) string {
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
	payloadToken := base64.RawURLEncoding.EncodeToString(encoded)
	return payloadToken + "." + c.sign(payloadToken)
}

// decode parses an opaque token produced by encode. Every malformed, tampered,
// or unsupported token collapses to ErrInvalidHistoryCursor so callers cannot
// distinguish encoding details.
func (c historyCursorCodec) decode(raw string) (HistoryCursor, error) {
	payloadToken, macToken, ok := strings.Cut(raw, ".")
	if !ok || payloadToken == "" || macToken == "" {
		return HistoryCursor{}, ErrInvalidHistoryCursor
	}
	if !hmac.Equal([]byte(c.sign(payloadToken)), []byte(macToken)) {
		return HistoryCursor{}, ErrInvalidHistoryCursor
	}

	decoded, err := base64.RawURLEncoding.DecodeString(payloadToken)
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

// sign returns the URL-safe MAC for an already-encoded payload.
func (c historyCursorCodec) sign(payloadToken string) string {
	mac := hmac.New(sha256.New, c.key)
	_, _ = mac.Write([]byte(payloadToken))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// encodeHistoryCursor renders a cursor with the default signing key.
func encodeHistoryCursor(cursor HistoryCursor) string {
	return defaultHistoryCursorCodec.encode(cursor)
}

// decodeHistoryCursor parses a cursor signed with the default signing key.
func decodeHistoryCursor(raw string) (HistoryCursor, error) {
	return defaultHistoryCursorCodec.decode(raw)
}
