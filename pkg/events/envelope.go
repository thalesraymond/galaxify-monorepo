package events

import "time"

type Envelope struct {
	EventId    string      `json:"event_id"`
	EventType  string      `json:"event_type"`
	OccurredAt time.Time   `json:"occurred_at"`
	Version    int         `json:"version"`
	Payload    interface{} `json:"payload"`
}
