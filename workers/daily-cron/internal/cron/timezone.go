package cron

import (
	"fmt"
	"time"

	"github.com/thalesraymond/galaxify-monorepo/pkg/dailytime"
)

// nextDailyDueDate returns the first scheduled local calendar-day occurrence
// after now. Ambiguous fall-back wall times use their first occurrence; a
// nonexistent spring-forward wall time moves to the first valid local instant
// after that wall time. DST resolution is shared with the Daily Service through
// pkg/dailytime.
func nextDailyDueDate(dueDate, now time.Time, timeZone string) (time.Time, error) {
	location, err := dailytime.LoadZone(timeZone)
	if err != nil {
		return time.Time{}, fmt.Errorf("load daily time zone %q: %w", timeZone, err)
	}

	next, ok := dailytime.NextOccurrenceAfter(dueDate, now, location)
	if !ok {
		return time.Time{}, fmt.Errorf("advance daily deadline after %s", now.Format(time.RFC3339))
	}
	return next, nil
}
