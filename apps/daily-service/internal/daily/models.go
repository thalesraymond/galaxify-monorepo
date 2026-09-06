package daily

import (
	"time"

	"github.com/google/uuid"
)

// Daily represents a task in the domain model.
type Daily struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	Title       string
	Description string
	Difficulty  string
	DueDate     time.Time
	Status      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// CreateInput defines parameters required to create a new daily task.
type CreateInput struct {
	UserID      uuid.UUID
	Title       string
	Description string
	Difficulty  string
	DueDate     time.Time
}

// UpdateInput defines optional fields when editing a pending daily task.
type UpdateInput struct {
	Title       *string
	Description *string
	Difficulty  *string
	DueDate     *time.Time
}
