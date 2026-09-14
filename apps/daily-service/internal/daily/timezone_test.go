package daily

import (
	"errors"
	"testing"
	"time"
)

func TestLoadTimeZoneRejectsNonIANAZones(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{name: "utc default", input: "UTC"},
		{name: "iana zone", input: "America/New_York"},
		{name: "go local is rejected", input: "Local", wantErr: true},
		{name: "empty is rejected", input: "", wantErr: true},
		{name: "bare abbreviation is rejected", input: "CET", wantErr: true},
		{name: "unknown zone is rejected", input: "Mars/Olympus", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := LoadTimeZone(tc.input)
			if tc.wantErr {
				if !errors.Is(err, ErrInvalidTimeZone) {
					t.Fatalf("LoadTimeZone(%q) error = %v, want ErrInvalidTimeZone", tc.input, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("LoadTimeZone(%q) unexpected error: %v", tc.input, err)
			}
		})
	}
}

func TestResolveLocalDeadlineHandlesDSTBoundaries(t *testing.T) {
	tests := []struct {
		name    string
		date    string
		clock   string
		zone    string
		wantUTC string
	}{
		{
			name: "ordinary wall time is preserved",
			date: "2026-09-15", clock: "09:30", zone: "America/New_York",
			wantUTC: "2026-09-15T13:30:00Z",
		},
		{
			name: "spring-forward gap moves to first valid instant",
			date: "2026-03-08", clock: "02:30", zone: "America/New_York",
			wantUTC: "2026-03-08T07:00:00Z",
		},
		{
			name: "fall-back ambiguity chooses first occurrence",
			date: "2026-11-01", clock: "01:30", zone: "America/New_York",
			wantUTC: "2026-11-01T05:30:00Z",
		},
		{
			name: "utc zone keeps the wall time as UTC",
			date: "2026-03-08", clock: "02:30", zone: "UTC",
			wantUTC: "2026-03-08T02:30:00Z",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ResolveLocalDeadline(tc.date, tc.clock, tc.zone)
			if err != nil {
				t.Fatalf("ResolveLocalDeadline() unexpected error: %v", err)
			}
			if got.UTC().Format(time.RFC3339) != tc.wantUTC {
				t.Errorf("ResolveLocalDeadline(%s %s %s) UTC = %s, want %s", tc.date, tc.clock, tc.zone, got.UTC().Format(time.RFC3339), tc.wantUTC)
			}
		})
	}
}

func TestResolveLocalDeadlineRejectsInvalidInput(t *testing.T) {
	tests := []struct {
		name  string
		date  string
		clock string
		zone  string
	}{
		{name: "invalid zone", date: "2026-09-15", clock: "09:30", zone: "Mars/Olympus"},
		{name: "invalid date", date: "15-09-2026", clock: "09:30", zone: "UTC"},
		{name: "invalid clock", date: "2026-09-15", clock: "25:00", zone: "UTC"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := ResolveLocalDeadline(tc.date, tc.clock, tc.zone); err == nil {
				t.Fatalf("ResolveLocalDeadline(%s %s %s) error = nil, want error", tc.date, tc.clock, tc.zone)
			}
		})
	}
}
