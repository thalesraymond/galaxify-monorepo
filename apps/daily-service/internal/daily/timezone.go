package daily

import (
	"fmt"
	"time"

	"github.com/thalesraymond/galaxify-monorepo/pkg/dailytime"
)

// LoadTimeZone loads an explicit IANA time-zone identifier for a Daily. UTC is
// retained as the deterministic compatibility default for pre-time-zone
// Dailies; Go's process-dependent "Local" location and other bare aliases are
// rejected so the persisted zone is always a real IANA name.
func LoadTimeZone(name string) (*time.Location, error) {
	location, err := dailytime.LoadZone(name)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidTimeZone, err)
	}
	return location, nil
}

// ResolveLocalDeadline converts a local calendar date (YYYY-MM-DD) and clock
// time (HH:MM) in an explicit IANA zone to its UTC instant. An ambiguous
// fall-back time selects the first occurrence; a nonexistent spring-forward
// time moves to the first valid local instant after the requested wall time.
func ResolveLocalDeadline(date, clock, timeZone string) (time.Time, error) {
	location, err := LoadTimeZone(timeZone)
	if err != nil {
		return time.Time{}, err
	}
	wallTime, err := time.Parse("2006-01-02 15:04", date+" "+clock)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse local deadline: %w", err)
	}
	return dailytime.ResolveWallClock(wallTime, location), nil
}
