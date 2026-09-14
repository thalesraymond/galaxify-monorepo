// Package dailytime resolves local wall-clock Daily deadlines against explicit
// IANA time zones and advances recurrence by local calendar days. The same
// resolution rules are shared by the Daily Service (create/update/read) and the
// daily-cron rollover worker so DST gaps and ambiguities are handled once.
package dailytime

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// ErrInvalidZone indicates a time-zone identifier that is not an explicit IANA
// zone name.
var ErrInvalidZone = errors.New("invalid IANA time zone")

// LoadZone loads an explicit IANA time-zone identifier. Go's process-dependent
// "Local" location and any other bare name that is not UTC are rejected so a
// persisted zone is always a real IANA name and the deployment host time zone
// can never change scheduling.
func LoadZone(name string) (*time.Location, error) {
	if name == "" || name == "Local" {
		return nil, fmt.Errorf("%w: %q", ErrInvalidZone, name)
	}
	if name != "UTC" && !strings.Contains(name, "/") {
		return nil, fmt.Errorf("%w: %q", ErrInvalidZone, name)
	}
	location, err := time.LoadLocation(name)
	if err != nil {
		return nil, fmt.Errorf("%w: %q", ErrInvalidZone, name)
	}
	return location, nil
}

// ResolveWallClock interprets the calendar and clock fields of wall as a local
// wall time in location and returns the matching instant. An ambiguous
// fall-back wall time selects its first occurrence. A nonexistent
// spring-forward wall time moves forward to the first valid local instant that
// preserves the requested clock fields, rather than silently moving the
// deadline backward.
//
// wall's fields are read in wall's own location, so callers can pass a time
// parsed in UTC (the usual case) or a time already converted with In(location).
func ResolveWallClock(wall time.Time, location *time.Location) time.Time {
	year, month, day := wall.Date()
	hour, minute, second := wall.Clock()
	nanosecond := wall.Nanosecond()

	// time.Date normalizes nonexistent clock values on a spring-forward day.
	// Walk forward until the candidate renders at or after the requested local
	// clock fields, so a gap becomes the first valid instant instead of an
	// earlier wall time.
	candidate := time.Date(year, month, day, hour, minute, second, nanosecond, location)
	for !sameOrLaterLocalClock(candidate.In(location), year, month, day, hour, minute, second) {
		candidate = candidate.Add(time.Minute)
	}
	return candidate
}

// NextOccurrenceAfter returns the first local calendar-day occurrence of the
// wall clock encoded in dueDate that falls strictly after now, using location
// to resolve each day. It reports false when no occurrence is found within a
// year (for example an invalid dueDate).
func NextOccurrenceAfter(dueDate, now time.Time, location *time.Location) (time.Time, bool) {
	local := dueDate.In(location)
	year, month, day := local.Date()
	hour, minute, second := local.Clock()
	nanosecond := local.Nanosecond()

	for offset := 1; offset <= 366; offset++ {
		// Build the wall clock for the next local day in UTC so time.Date's
		// normalization cannot itself apply a DST offset.
		wall := time.Date(year, month, day+offset, hour, minute, second, nanosecond, time.UTC)
		candidate := ResolveWallClock(wall, location)
		if candidate.After(now) {
			return candidate, true
		}
	}
	return time.Time{}, false
}

func sameOrLaterLocalClock(candidate time.Time, year int, month time.Month, day, hour, minute, second int) bool {
	if candidate.Year() != year || candidate.Month() != month || candidate.Day() != day {
		return candidate.Year() > year ||
			(candidate.Year() == year && candidate.Month() > month) ||
			(candidate.Year() == year && candidate.Month() == month && candidate.Day() > day)
	}
	if candidate.Hour() != hour {
		return candidate.Hour() > hour
	}
	if candidate.Minute() != minute {
		return candidate.Minute() > minute
	}
	return candidate.Second() >= second
}
