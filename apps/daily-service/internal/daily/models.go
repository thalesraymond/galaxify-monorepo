package daily

import (
	"time"

	"github.com/google/uuid"
)

// Difficulty represents the task difficulty level.
type Difficulty string

// Valid difficulty levels
const (
	DifficultyEasy   Difficulty = "EASY"
	DifficultyMedium Difficulty = "MEDIUM"
	DifficultyHard   Difficulty = "HARD"
)

var validDifficulties = map[Difficulty]struct{}{
	DifficultyEasy:   {},
	DifficultyMedium: {},
	DifficultyHard:   {},
}

// IsValidDifficulty checks if the given difficulty tier is supported.
func IsValidDifficulty(d Difficulty) bool {
	_, ok := validDifficulties[d]
	return ok
}

// Status represents the state of a daily task in its lifecycle.
type Status string

// Valid task statuses
const (
	StatusPending   Status = "PENDING"
	StatusCompleted Status = "COMPLETED"
	StatusMissed    Status = "MISSED"
)

var validStatuses = map[Status]struct{}{
	StatusPending:   {},
	StatusCompleted: {},
	StatusMissed:    {},
}

// IsValidStatus checks if the given status is supported.
func IsValidStatus(s Status) bool {
	_, ok := validStatuses[s]
	return ok
}

// Daily represents a task in the domain model.
type Daily struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	Title       string
	Description string
	Difficulty  Difficulty
	DueDate     time.Time
	Status      Status
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// CreateInput defines parameters required to create a new daily task.
type CreateInput struct {
	UserID      uuid.UUID
	Title       string
	Description string
	Difficulty  Difficulty
	DueDate     time.Time
}

// ListFilter defines optional filtering criteria when querying dailies.
type ListFilter struct {
	Status *Status
	Date   *time.Time
}

// UpdateInput defines optional fields when editing a pending daily task.
type UpdateInput struct {
	Title       *string
	Description *string
	Difficulty  *Difficulty
	DueDate     *time.Time
}
