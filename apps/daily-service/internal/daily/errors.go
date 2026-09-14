package daily

import "errors"

var (
	// ErrDailyNotFound indicates the requested daily task does not exist.
	ErrDailyNotFound = errors.New("daily not found")

	// ErrDailyNotPending indicates a mutation was attempted on a daily that is not pending.
	ErrDailyNotPending = errors.New("daily is not pending")

	// ErrDailyAlreadyCompleted indicates completion was attempted on a non-pending daily.
	ErrDailyAlreadyCompleted = errors.New("daily already completed")

	// ErrInvalidDifficulty indicates an unsupported difficulty tier.
	ErrInvalidDifficulty = errors.New("invalid difficulty")

	// ErrInvalidTimeZone indicates an unsupported IANA time zone.
	ErrInvalidTimeZone = errors.New("invalid daily time zone")

	// ErrInvalidHistoryCursor indicates a continuation token that is malformed,
	// tampered with, or no longer structurally recognisable. The handler maps it
	// to a field-scoped validation error without echoing the token's contents.
	ErrInvalidHistoryCursor = errors.New("invalid daily history cursor")

	// ErrTitleTooLong indicates a Daily title exceeds MaxTitleLength.
	ErrTitleTooLong = errors.New("daily title exceeds maximum length")

	// ErrDescriptionTooLong indicates a Daily description exceeds MaxDescriptionLength.
	ErrDescriptionTooLong = errors.New("daily description exceeds maximum length")

	// ErrPlayerNotReady indicates the Player's Daily state has not finished
	// provisioning: the user.created consumer has not yet populated users_cache,
	// so Daily facts cannot be established. It is retryable, not terminal.
	ErrPlayerNotReady = errors.New("daily player state not ready")
)
