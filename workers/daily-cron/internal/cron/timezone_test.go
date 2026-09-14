package cron

import (
	"testing"
	"time"
)

func TestNextDailyDueDatePreservesLocalScheduleAcrossDST(t *testing.T) {
	newYork, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name     string
		dueDate  time.Time
		now      time.Time
		want     time.Time
		wantHour int
		wantMin  int
		wantUTC  string
	}{
		{
			name:     "spring forward preserves ordinary wall time",
			dueDate:  time.Date(2026, 3, 7, 9, 30, 0, 0, newYork),
			now:      time.Date(2026, 3, 7, 10, 0, 0, 0, newYork),
			want:     time.Date(2026, 3, 8, 9, 30, 0, 0, newYork),
			wantHour: 9, wantMin: 30,
		},
		{
			name:     "spring forward nonexistent time moves forward to first valid instant",
			dueDate:  time.Date(2026, 3, 7, 2, 30, 0, 0, newYork),
			now:      time.Date(2026, 3, 7, 3, 0, 0, 0, newYork),
			want:     time.Date(2026, 3, 8, 3, 0, 0, 0, newYork),
			wantHour: 3, wantMin: 0,
		},
		{
			name:     "fall back preserves wall time and chooses first occurrence",
			dueDate:  time.Date(2026, 10, 31, 1, 30, 0, 0, newYork),
			now:      time.Date(2026, 10, 31, 2, 0, 0, 0, newYork),
			want:     time.Date(2026, 11, 1, 1, 30, 0, 0, newYork),
			wantHour: 1, wantMin: 30,
			wantUTC: "2026-11-01T05:30:00Z",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := nextDailyDueDate(tc.dueDate, tc.now, "America/New_York")
			if err != nil {
				t.Fatal(err)
			}
			if !got.Equal(tc.want) {
				t.Errorf("nextDailyDueDate() = %s, want %s", got, tc.want)
			}
			local := got.In(newYork)
			if local.Hour() != tc.wantHour || local.Minute() != tc.wantMin {
				t.Errorf("local deadline = %s, want %02d:%02d", local, tc.wantHour, tc.wantMin)
			}
			if tc.wantUTC != "" && got.UTC().Format(time.RFC3339) != tc.wantUTC {
				t.Errorf("ambiguous deadline UTC = %s, want first occurrence %s", got.UTC().Format(time.RFC3339), tc.wantUTC)
			}
		})
	}
}
