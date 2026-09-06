package publisher

import "context"

// EventPublisher is the minimal interface for publishing domain events.
type EventPublisher interface {
	Publish(ctx context.Context, eventType string, payload any) error
}

// NoOpPublisher is a no-op implementation of EventPublisher.
type NoOpPublisher struct{}

// NewNoOpPublisher returns a new NoOpPublisher.
func NewNoOpPublisher() *NoOpPublisher {
	return &NoOpPublisher{}
}

// Publish is a no-op implementation of EventPublisher.Publish.
func (p *NoOpPublisher) Publish(ctx context.Context, eventType string, payload any) error {
	return nil
}
