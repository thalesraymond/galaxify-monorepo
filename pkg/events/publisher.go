package events

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/rabbitmq/amqp091-go"

	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// PublisherChannel is the subset of amqp091.Channel the Publisher needs.
// *amqp091.Channel satisfies it directly; tests can substitute a fake.
type PublisherChannel interface {
	ExchangeDeclare(name, kind string, durable, autoDelete, internal, noWait bool, args amqp091.Table) error
	Publish(exchange, key string, mandatory, immediate bool, msg amqp091.Publishing) error
	Close() error
}

// Compile-time assertion that *amqp091.Channel satisfies PublisherChannel.
var _ PublisherChannel = (*amqp091.Channel)(nil)

type Publisher struct {
	channel PublisherChannel
	logger  *slog.Logger
}

func NewPublisher(channel PublisherChannel, opts ...Option) (*Publisher, error) {
	o := applyOptions(opts)

	err := channel.ExchangeDeclare(
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

	return &Publisher{channel: channel, logger: o.logger}, nil
}

func (p *Publisher) Publish(ctx context.Context, eventType string, payload any) error {
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

	if requestID := sharedhttp.RequestIDFromContext(ctx); requestID != "" {
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

	p.logger.Debug("event published",
		"event_id", eventID,
		"event_type", eventType,
	)

	return nil
}

func (p *Publisher) Close() error {
	return p.channel.Close()
}
