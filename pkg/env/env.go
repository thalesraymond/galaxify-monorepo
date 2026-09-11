// Package env provides environment-variable lookup helpers shared by the
// services and workers for their .env-driven configuration.
package env

import (
	"os"
	"time"
)

// Or returns the value of the environment variable key, or fallback when it
// is unset or empty.
func Or(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// DurationOr returns the environment variable key parsed as a duration, or
// fallback when it is unset, empty, or not a valid duration.
func DurationOr(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return fallback
		}
		return d
	}
	return fallback
}
