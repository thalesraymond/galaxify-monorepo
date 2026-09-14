package cron

import (
	"fmt"
	"time"
)

// nextDailyDueDate returns the first scheduled local calendar-day occurrence
// after now. Ambiguous fall-back wall times use Go's first occurrence; a
// nonexistent spring-forward wall time moves to the first valid local instant
// after that wall time.
func nextDailyDueDate(dueDate, now time.Time, timeZone string) (time.Time, error) {
	location, err := time.LoadLocation(timeZone)
	if err != nil {
		return time.Time{}, fmt.Errorf("load daily time zone %q: %w", timeZone, err)
	}

	localDueDate := dueDate.In(location)
	year, month, localDay := localDueDate.Date()
	hour, minute, second := localDueDate.Clock()
	for day := 1; day <= 366; day++ {
		date := time.Date(year, month, localDay+day, 0, 0, 0, 0, location)
		candidate := localDailyOccurrence(date.Year(), date.Month(), date.Day(), hour, minute, second, localDueDate.Nanosecond(), location)
		if candidate.After(now) {
			return candidate, nil
		}
	}
	return time.Time{}, fmt.Errorf("advance daily deadline after %s", now.Format(time.RFC3339))
}

func localDailyOccurrence(year int, month time.Month, day, hour, minute, second, nanosecond int, location *time.Location) time.Time {
	candidate := time.Date(year, month, day, hour, minute, second, nanosecond, location)

	// time.Date normalizes nonexistent clock values on a spring-forward day.
	// Move forward to the first valid local instant rather than silently moving
	// the deadline backward.
	for !sameOrLaterLocalClock(candidate.In(location), year, month, day, hour, minute, second) {
		candidate = candidate.Add(time.Minute)
	}
	return candidate
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
