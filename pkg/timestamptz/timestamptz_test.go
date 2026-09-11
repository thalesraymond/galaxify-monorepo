package timestamptz

import (
	"testing"
	"time"
)

func TestFromTime(t *testing.T) {
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)

	got := FromTime(now)
	if !got.Valid {
		t.Error("got.Valid = false, want true")
	}
	if !got.Time.Equal(now) {
		t.Errorf("got.Time = %v, want %v", got.Time, now)
	}
}
