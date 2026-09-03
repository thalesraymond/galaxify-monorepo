package sharedhttp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWriteJSON(t *testing.T) {
	type testBody struct {
		Message string `json:"message"`
		Code    int    `json:"code"`
	}

	tests := []struct {
		name         string
		status       int
		body         any
		expectedBody string
	}{
		{
			name:   "success with OK status",
			status: http.StatusOK,
			body: testBody{
				Message: "Success",
				Code:    200,
			},
			expectedBody: `{"message":"Success","code":200}` + "\n",
		},
		{
			name:   "success with Created status",
			status: http.StatusCreated,
			body: map[string]string{
				"id": "123",
			},
			expectedBody: `{"id":"123"}` + "\n",
		},
		{
			name:         "nil body",
			status:       http.StatusNoContent,
			body:         nil,
			expectedBody: "null\n",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()

			WriteJSON(rec, tt.status, tt.body)

			if rec.Code != tt.status {
				t.Errorf("status = %d, want %d", rec.Code, tt.status)
			}

			if contentType := rec.Header().Get("Content-Type"); contentType != "application/json" {
				t.Errorf("Content-Type = %q, want %q", contentType, "application/json")
			}

			if rec.Body.String() != tt.expectedBody {
				t.Errorf("body = %q, want %q", rec.Body.String(), tt.expectedBody)
			}
		})
	}
}
