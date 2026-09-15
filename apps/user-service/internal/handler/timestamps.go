package handler

import "time"

// formatTimestamp renders RFC3339 instants in canonical UTC (`Z`) form. The
// locked OpenAPI contract describes `created_at`/`updated_at` as RFC3339
// date-time values, and the browser contract parser plus the MSW fixtures both
// emit/accept the UTC `Z` representation; emitting the local zone offset breaks
// that client contract parse. The service owns the wire timestamp, so it
// canonicalizes to UTC before it ever leaves the handler boundary.
func formatTimestamp(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}