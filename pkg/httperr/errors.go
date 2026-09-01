// Package httperr provides the HTTP error envelope shared by all Galaxify
// services. Every error response has the shape:
//
//	{
//	  "error": {
//	    "code": "DAILY_NOT_FOUND",
//	    "message": "Daily task not found"
//	  }
//	}
//
// Codes are flat SCREAMING_SNAKE with a service prefix; each service owns its
// prefix by convention and there is no central registry. The X-Request-Id
// response header is set by the request ID middleware on every response and
// never appears in the envelope body.
package httperr

import (
	"log/slog"
	"net/http"

	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// ErrorResponse is the envelope for every error response.
type ErrorResponse struct {
	Error ErrorBody `json:"error"`
}

// ErrorBody is the inner error object of the envelope.
type ErrorBody struct {
	Code    string        `json:"code"`
	Message string        `json:"message"`
	Details *ErrorDetails `json:"details,omitempty"`
}

// ErrorDetails carries structured detail about a failure. Only validation
// errors currently populate FieldErrors.
type ErrorDetails struct {
	FieldErrors map[string]string `json:"field_errors"`
}

// WriteError writes an error response with the given status, code, and
// message. Codes are not derivable from the HTTP status — they are orthogonal,
// so clients branch on code, not status.
func WriteError(w http.ResponseWriter, status int, code, message string) {
	sharedhttp.WriteJSON(w, status, ErrorResponse{
		Error: ErrorBody{
			Code:    code,
			Message: message,
		},
	})
}

// WriteValidationError writes a 422 Unprocessable Entity response with
// code VALIDATION_FAILED and a flat {field: human_message} map describing each
// failing field.
func WriteValidationError(w http.ResponseWriter, fieldErrors map[string]string) {
	sharedhttp.WriteJSON(w, http.StatusUnprocessableEntity, ErrorResponse{
		Error: ErrorBody{
			Code:    "VALIDATION_FAILED",
			Message: "request validation failed",
			Details: &ErrorDetails{FieldErrors: fieldErrors},
		},
	})
}

// WriteInternal writes a 500 Internal Server Error with a generic message and
// logs the underlying error with the request_id so support can correlate logs
// to the failed request. The X-Request-Id response header is the lookup key.
func WriteInternal(w http.ResponseWriter, r *http.Request, err error, logger *slog.Logger) {
	logger.Error("internal error",
		"request_id", sharedhttp.RequestIDFromContext(r.Context()),
		"error", err,
	)
	WriteError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred")
}
