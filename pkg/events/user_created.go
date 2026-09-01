package events

type UserCreated struct {
	Version  int    `json:"version"` // 1
	UserID   string `json:"user_id"` // UUID
	Email    string `json:"email"`
	Username string `json:"username"`
}
