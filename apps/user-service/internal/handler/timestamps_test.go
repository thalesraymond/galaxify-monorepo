package handler

import (
	"testing"
	"time"
)

func TestFormatTimestamp(t *testing.T) {
	utc := time.FixedZone("UTC", 0)
	business := time.FixedZone("business", -3*60*60)

	tests := []struct {
		name string
		in   time.Time
		want string
	}{
		{
			name: "utc zulu",
			in:   time.Date(2026, 9, 1, 12, 0, 0, 0, utc),
			want: "2026-09-01T12:00:00Z",
		},
		{
			name: "offset zone canonicalized to utc",
			in:   time.Date(2026, 9, 1, 12, 0, 0, 0, business),
			want: "2026-09-01T15:00:00Z",
		},
		{
			name: "sub-second precision dropped per rfc3339 second form",
			in:   time.Date(2026, 9, 1, 12, 0, 0, 123_000_000, utc),
			want: "2026-09-01T12:00:00Z",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := formatTimestamp(tc.in); got != tc.want {
				t.Fatalf("formatTimestamp(%v) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
