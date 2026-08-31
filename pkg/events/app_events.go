package events

import "time"

type Envelope struct {
	EventId    string      `json:"event_id"`
	EventType  string      `json:"event_type"`
	OccurredAt time.Time   `json:"occurred_at"`
	Version    int         `json:"version"`
	Payload    interface{} `json:"payload"`
}

type UserCreated struct {
	Version  int    `json:"version"` // 1
	UserID   string `json:"user_id"` // UUID
	Email    string `json:"email"`
	Username string `json:"username"`
}

type DailyCompleted struct {
	Version         int    `json:"version"`    // 1
	UserID          string `json:"user_id"`    // UUID
	DailyID         string `json:"daily_id"`   // UUID
	Difficulty      string `json:"difficulty"` // EASY | MEDIUM | HARD
	RewardMaterials int    `json:"reward_materials"`
}

type DailyMissed struct {
	Version      int    `json:"version"`  // 1
	UserID       string `json:"user_id"`  // UUID
	DailyID      string `json:"daily_id"` // UUID
	DamageAmount int    `json:"damage_amount"`
}

type ShipStatusUpdated struct {
	Version          int    `json:"version"`     // 1
	UserID           string `json:"user_id"`     // UUID
	HullHealth       int    `json:"hull_health"` // 0-100
	MaterialsBalance int    `json:"materials_balance"`
}
