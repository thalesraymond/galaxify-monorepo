package events

type DailyCompleted struct {
	Version         int    `json:"version"`    // 1
	UserID          string `json:"user_id"`    // UUID
	DailyID         string `json:"daily_id"`   // UUID
	Difficulty      string `json:"difficulty"` // EASY | MEDIUM | HARD
	RewardMaterials int    `json:"reward_materials"`
}
