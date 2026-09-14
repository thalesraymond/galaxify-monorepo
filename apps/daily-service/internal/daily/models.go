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

// Content length limits for a Daily. They mirror the web form limits in the
// Web Frontend Specification §5.3 and bound both create and update.
const (
	MaxTitleLength       = 120
	MaxDescriptionLength = 1000
)

// DifficultyMetadata describes the backend-owned reward and missed-hull-damage
// facts for one difficulty tier. It is the single source of truth for the
// difficulty metadata endpoint and the awarded-material effect of completion.
type DifficultyMetadata struct {
	Difficulty      Difficulty
	RewardMaterials int
	DamageAmount    int
}

// Daily represents a task in the domain model.
type Daily struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	Title       string
	Description string
	Difficulty  Difficulty
	DueDate     time.Time
	TimeZone    string
	Status      Status
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// DailyHistory represents an archival log entry of a completed or missed daily task cycle.
type DailyHistory struct {
	ID          uuid.UUID
	DailyID     uuid.UUID
	UserID      uuid.UUID
	Title       string
	Description string
	Difficulty  Difficulty
	DueDate     time.Time
	TimeZone    string
	Status      Status
	CompletedAt *time.Time
	MissedAt    *time.Time
	ArchivedAt  time.Time
}

// Completion is the outcome of marking a Daily COMPLETED: the completed Daily
// plus the awarded-material effect sourced from the difficulty_rewards table.
type Completion struct {
	Daily
	AwardedMaterials int
}

// CreateInput defines parameters required to create a new daily task.
type CreateInput struct {
	UserID      uuid.UUID
	Title       string
	Description string
	Difficulty  Difficulty
	DueDate     time.Time
	TimeZone    string
}

// ListFilter defines optional filtering criteria when querying dailies.
type ListFilter struct {
	Status *Status
	From   *time.Time
	To     *time.Time
}

// HistoryQuery bounds one Daily History page. Limit is clamped to
// [1, MaxHistoryPageSize]; a non-positive Limit selects DefaultHistoryPageSize.
// Cursor is the opaque continuation token returned as the previous page's
// NextCursor; an empty Cursor starts at the newest occurrence.
type HistoryQuery struct {
	Limit  int
	Cursor string
}

// HistoryPage is one stable descending page of a user's Daily History. Items
// never overlap or skip entries when traversed with NextCursor. NextCursor is
// empty exactly when this is the final page, so clients stop unambiguously on
// both an empty page and a partially-filled last page.
type HistoryPage struct {
	Items      []DailyHistory
	NextCursor string
}

// HistoryCursor is the unique, tie-breaker-complete position of the last item
// on a page: the (DueDate, ArchivedAt, ID) sort key the next page continues
// strictly after.
type HistoryCursor struct {
	DueDate    time.Time
	ArchivedAt time.Time
	ID         uuid.UUID
}

// UpdateInput defines optional fields when editing a pending daily task.
type UpdateInput struct {
	Title       *string
	Description *string
	Difficulty  *Difficulty
	DueDate     *time.Time
	TimeZone    *string
}
