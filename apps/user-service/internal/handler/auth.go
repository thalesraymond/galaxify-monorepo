package handler

import (
	"context"

	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
)

// EventPublisher is the narrow surface used by handlers to emit domain events.
type EventPublisher interface {
	Publish(ctx context.Context, eventType string, payload any, opts ...events.PublishOption) error
}

// userResponse is the shared on-the-wire shape for a user resource.
type userResponse struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Username  string `json:"username"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// authSessionResponse is the shared success envelope for signup, login, and
// refresh. Concrete aliases keep handler response types self-describing.
type authSessionResponse struct {
	User         userResponse `json:"user"`
	AccessToken  string       `json:"access_token"`
	RefreshToken string       `json:"refresh_token"`
}

type signupResponse = authSessionResponse
type loginResponse = authSessionResponse

// refreshResponse is the slim envelope returned by POST /auth/refresh.
// Per spec §3.3 it carries only the two tokens (no user object).
type refreshResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}
