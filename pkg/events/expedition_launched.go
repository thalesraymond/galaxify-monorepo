package events

type ExpeditionLaunched struct {
	Version           int     `json:"version"`       // 1
	UserID            string  `json:"user_id"`       // UUID
	ExpeditionID      string  `json:"expedition_id"` // UUID
	MaterialsInvested int     `json:"materials_invested"`
	SuccessChance     float64 `json:"success_chance"`
	ResolveAt         string  `json:"resolve_at"` // RFC3339
}
