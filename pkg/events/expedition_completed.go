package events

type ExpeditionCompleted struct {
	Version         int    `json:"version"`       // 1
	UserID          string `json:"user_id"`       // UUID
	ExpeditionID    string `json:"expedition_id"` // UUID
	Outcome         string `json:"outcome"`       // SUCCESS | FAILURE
	MaterialsReward int    `json:"materials_reward"`
}
