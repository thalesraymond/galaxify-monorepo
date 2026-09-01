package events

type DailyMissed struct {
	Version      int    `json:"version"`  // 1
	UserID       string `json:"user_id"`  // UUID
	DailyID      string `json:"daily_id"` // UUID
	DamageAmount int    `json:"damage_amount"`
}
