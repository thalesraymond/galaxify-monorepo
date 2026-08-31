package events

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rabbitmq/amqp091-go"
)

type contextKey string

const requestIDKey contextKey = "X-Request-ID"

type Publisher struct {
	channel *amqp091.Channel
}

func NewPublisher(conn *amqp091.Connection) (*Publisher, error) {
	ch, err := conn.Channel()
	if err != nil {
		return nil, fmt.Errorf("failed to create channel: %w", err)
	}

	err = ch.ExchangeDeclare(
		"galaxify.events", // name
		"topic",           // kind
		true,              // durable
		false,             // auto-delete
		false,             // internal
		false,             // no-wait
		nil,               // arguments
	)

	if err != nil {
		return nil, fmt.Errorf("failed to declare exchange: %w", err)
	}

	return &Publisher{channel: ch}, nil
}

func (p *Publisher) Publish(ctx context.Context, eventType string, payload interface{}) error {
	eventID := uuid.New().String()

	envelope := Envelope{
		EventId:    eventID,
		EventType:  eventType,
		OccurredAt: time.Now(),
		Version:    1,
		Payload:    payload,
	}

	body, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	props := amqp091.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp091.Persistent,
		Body:         body,
	}

	if requestID := RequestIDFromContext(ctx); requestID != "" {
		if props.Headers == nil {
			props.Headers = amqp091.Table{}
		}
		props.Headers["X-Request-ID"] = requestID
	}

	err = p.channel.Publish(
		"galaxify.events", // exchange
		eventType,         // routing key
		false,             // mandatory
		false,             // immediate
		props,             // body/properties
	)
	if err != nil {
		return fmt.Errorf("failed to publish event: %w", err)
	}

	return nil
}

func (p *Publisher) Close() error {
	return p.channel.Close()
}

// RequestIDFromContext extracts the request ID from the context.
// This is a placeholder — the real implementation will live in pkg/http
// once the request ID middleware is implemented. For now, it returns empty
// string so compilation succeeds.
//
// TODO: Replace with actual implementation from pkg/http when available.
func RequestIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	v := ctx.Value(requestIDKey)
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// WithRequestID returns a new context with the given request ID attached.
// This is used by the request ID middleware to propagate the ID through
// the handler chain.
//
// TODO: Move to pkg/http when the middleware is implemented.
func WithRequestID(ctx context.Context, requestID string) context.Context {
	return context.WithValue(ctx, requestIDKey, requestID)
}
