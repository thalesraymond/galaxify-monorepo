package events

import (
	"encoding/json"
	"time"
)

type Envelope struct {
	EventId    string    `json:"event_id"`
	EventType  string    `json:"event_type"`
	OccurredAt time.Time `json:"occurred_at"`
	Version    int             `json:"version"`
	Payload    json.RawMessage `json:"payload"`
}
