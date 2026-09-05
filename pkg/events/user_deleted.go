package events

// UserDeleted is published when a user account is permanently deleted.
// Consumers (daily, ship, expedition) should cascade-delete their per-user
// data on receipt.
type UserDeleted struct {
	Version int    `json:"version"`  // 1
	UserID  string `json:"user_id"` // UUID
}
