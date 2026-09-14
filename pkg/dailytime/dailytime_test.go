package dailytime

import (
	"errors"
	"testing"
	"time"
)

func TestLoadZoneRejectsNonIANAIdentifiers(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{name: "utc is accepted", input: "UTC"},
		{name: "slash zone is accepted", input: "America/New_York"},
		{name: "etc zone is accepted", input: "Etc/UTC"},
		{name: "go local is rejected", input: "Local", wantErr: true},
		{name: "empty is rejected", input: "", wantErr: true},
		{name: "bare abbreviation is rejected", input: "EST", wantErr: true},
		{name: "unknown slash zone is rejected", input: "Mars/Olympus", wantErr: true},
		{name: "fixed offset is rejected", input: "+02:00", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			location, err := LoadZone(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("LoadZone(%q) error = nil, want error", tc.input)
				}
				if !errors.Is(err, ErrInvalidZone) {
					t.Errorf("LoadZone(%q) error = %v, want ErrInvalidZone", tc.input, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("LoadZone(%q) unexpected error: %v", tc.input, err)
			}
			if location == nil {
				t.Fatalf("LoadZone(%q) returned nil location", tc.input)
			}
		})
	}
}

func TestResolveWallClockHandlesDSTBoundaries(t *testing.T) {
	newYork, err := LoadZone("America/New_York")
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name     string
		wall     time.Time
		wantUTC  string
		wantHour int
		wantMin  int
	}{
		{
			name:     "ordinary winter wall time is preserved",
			wall:     time.Date(2026, 3, 7, 9, 30, 0, 0, time.UTC),
			wantUTC:  "2026-03-07T14:30:00Z",
			wantHour: 9, wantMin: 30,
		},
		{
			name:     "spring-forward gap moves to first valid instant",
			wall:     time.Date(2026, 3, 8, 2, 30, 0, 0, time.UTC),
			wantUTC:  "2026-03-08T07:00:00Z",
			wantHour: 3, wantMin: 0,
		},
		{
			name:     "fall-back ambiguity chooses first occurrence",
			wall:     time.Date(2026, 11, 1, 1, 30, 0, 0, time.UTC),
			wantUTC:  "2026-11-01T05:30:00Z",
			wantHour: 1, wantMin: 30,
		},
		{
			name:     "summer wall time is preserved",
			wall:     time.Date(2026, 7, 1, 9, 30, 0, 0, time.UTC),
			wantUTC:  "2026-07-01T13:30:00Z",
			wantHour: 9, wantMin: 30,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ResolveWallClock(tc.wall, newYork)
			if got.UTC().Format(time.RFC3339) != tc.wantUTC {
				t.Errorf("ResolveWallClock(%s) UTC = %s, want %s", tc.wall.Format("2006-01-02 15:04"), got.UTC().Format(time.RFC3339), tc.wantUTC)
			}
			local := got.In(newYork)
			if local.Hour() != tc.wantHour || local.Minute() != tc.wantMin {
				t.Errorf("ResolveWallClock(%s) local = %02d:%02d, want %02d:%02d", tc.wall.Format("2006-01-02 15:04"), local.Hour(), local.Minute(), tc.wantHour, tc.wantMin)
			}
		})
	}
}

func TestNextOccurrenceAfterPreservesLocalScheduleAcrossDST(t *testing.T) {
	newYork, err := LoadZone("America/New_York")
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name     string
		dueDate  time.Time
		now      time.Time
		wantUTC  string
		wantHour int
		wantMin  int
		wantOK   bool
	}{
		{
			name:     "spring forward preserves ordinary wall time",
			dueDate:  time.Date(2026, 3, 7, 9, 30, 0, 0, newYork),
			now:      time.Date(2026, 3, 7, 10, 0, 0, 0, newYork),
			wantUTC:  "2026-03-08T13:30:00Z",
			wantHour: 9, wantMin: 30, wantOK: true,
		},
		{
			name:     "spring forward gap moves forward to first valid instant",
			dueDate:  time.Date(2026, 3, 7, 2, 30, 0, 0, newYork),
			now:      time.Date(2026, 3, 7, 3, 0, 0, 0, newYork),
			wantUTC:  "2026-03-08T07:00:00Z",
			wantHour: 3, wantMin: 0, wantOK: true,
		},
		{
			name:     "fall back ambiguity chooses first occurrence",
			dueDate:  time.Date(2026, 10, 31, 1, 30, 0, 0, newYork),
			now:      time.Date(2026, 10, 31, 2, 0, 0, 0, newYork),
			wantUTC:  "2026-11-01T05:30:00Z",
			wantHour: 1, wantMin: 30, wantOK: true,
		},
		{
			name:     "skips past multiple elapsed local days",
			dueDate:  time.Date(2026, 3, 5, 9, 0, 0, 0, newYork),
			now:      time.Date(2026, 3, 9, 12, 0, 0, 0, newYork),
			wantUTC:  "2026-03-10T13:00:00Z",
			wantHour: 9, wantMin: 0, wantOK: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := NextOccurrenceAfter(tc.dueDate, tc.now, newYork)
			if ok != tc.wantOK {
				t.Fatalf("NextOccurrenceAfter() ok = %v, want %v", ok, tc.wantOK)
			}
			if !ok {
				return
			}
			if got.UTC().Format(time.RFC3339) != tc.wantUTC {
				t.Errorf("NextOccurrenceAfter() UTC = %s, want %s", got.UTC().Format(time.RFC3339), tc.wantUTC)
			}
			local := got.In(newYork)
			if local.Hour() != tc.wantHour || local.Minute() != tc.wantMin {
				t.Errorf("NextOccurrenceAfter() local = %02d:%02d, want %02d:%02d", local.Hour(), local.Minute(), tc.wantHour, tc.wantMin)
			}
		})
	}
}
