package events

type ShipStatusUpdated struct {
	Version          int    `json:"version"`     // 1
	UserID           string `json:"user_id"`     // UUID
	HullHealth       int    `json:"hull_health"` // 0-100
	MaterialsBalance int    `json:"materials_balance"`
}
