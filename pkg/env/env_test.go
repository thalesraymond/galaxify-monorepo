package env

import (
	"testing"
	"time"
)

func TestOr(t *testing.T) {
	t.Setenv("ENV_OR_SET", "value")
	t.Setenv("ENV_OR_EMPTY", "")

	tests := []struct {
		name     string
		key      string
		fallback string
		want     string
	}{
		{"set variable returns its value", "ENV_OR_SET", "fallback", "value"},
		{"unset variable returns fallback", "ENV_OR_UNSET", "fallback", "fallback"},
		{"empty variable returns fallback", "ENV_OR_EMPTY", "fallback", "fallback"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Or(tt.key, tt.fallback); got != tt.want {
				t.Errorf("Or(%q, %q) = %q, want %q", tt.key, tt.fallback, got, tt.want)
			}
		})
	}
}

func TestDurationOr(t *testing.T) {
	fallback := 5 * time.Minute

	tests := []struct {
		name   string
		key    string
		value  string // environment value to install
		setEnv bool   // false leaves the variable unset
		want   time.Duration
	}{
		{"valid duration is parsed", "ENV_DURATION_VALID", "90s", true, 90 * time.Second},
		{"invalid duration falls back", "ENV_DURATION_INVALID", "not-a-duration", true, fallback},
		{"empty value falls back", "ENV_DURATION_EMPTY", "", true, fallback},
		{"unset variable falls back", "ENV_DURATION_UNSET", "", false, fallback},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setEnv {
				t.Setenv(tt.key, tt.value)
			}
			if got := DurationOr(tt.key, fallback); got != tt.want {
				t.Errorf("DurationOr(%q, %v) = %v, want %v", tt.key, fallback, got, tt.want)
			}
		})
	}
}
