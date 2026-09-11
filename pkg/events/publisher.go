package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rabbitmq/amqp091-go"

	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// PublisherChannel is the subset of amqp091.Channel the Publisher needs.
// *amqp091.Channel satisfies it directly; tests can substitute a fake.
type PublisherChannel interface {
	ExchangeDeclare(name, kind string, durable, autoDelete, internal, noWait bool, args amqp091.Table) error
	QueueDeclare(name string, durable, autoDelete, exclusive, noWait bool, args amqp091.Table) (amqp091.Queue, error)
	QueueBind(name, key, exchange string, noWait bool, args amqp091.Table) error
	Confirm(noWait bool) error
	GetNextPublishSeqNo() uint64
	NotifyPublish(confirm chan amqp091.Confirmation) chan amqp091.Confirmation
	Publish(exchange, key string, mandatory, immediate bool, msg amqp091.Publishing) error
	Close() error
}

// Compile-time assertion that *amqp091.Channel satisfies PublisherChannel.
var _ PublisherChannel = (*amqp091.Channel)(nil)

type Publisher struct {
	mu            sync.Mutex
	channel       PublisherChannel
	confirmations <-chan amqp091.Confirmation
	logger        *slog.Logger
}

// EventPublisher publishes domain events using the Galaxify event envelope.
// It is satisfied by Publisher and lets domain packages substitute a recorder
// in unit tests.
type EventPublisher interface {
	Publish(ctx context.Context, eventType string, payload any, opts ...PublishOption) error
}

var _ EventPublisher = (*Publisher)(nil)

// PublishOption configures a single Publish call.
type PublishOption func(*publishOptions)

type publishOptions struct {
	eventID    string
	occurredAt time.Time
}

// WithOccurredAt preserves the event's original occurrence time across outbox retries.
func WithOccurredAt(occurredAt time.Time) PublishOption {
	return func(o *publishOptions) {
		o.occurredAt = occurredAt
	}
}

// WithEventID uses the provided event ID in the envelope instead of generating
// a new one. This is required when publishing from an outbox row so that
// duplicate delivery attempts share the same idempotency key.
func WithEventID(eventID string) PublishOption {
	return func(o *publishOptions) {
		o.eventID = eventID
	}
}

func applyPublishOptions(opts []PublishOption) publishOptions {
	var o publishOptions
	for _, opt := range opts {
		opt(&o)
	}
	return o
}

// NewPublisher declares the event topology and returns a Publisher for it:
// the galaxify.events topic exchange, plus the alternate-exchange safety net
// (galaxify.ae fanout exchange bound to the galaxify.unroutable queue) that
// captures events with no matching queue binding instead of letting RabbitMQ
// drop them. All declarations are idempotent, so every service may run them,
// in any order, on every boot. See ADR-0009.
func NewPublisher(channel PublisherChannel, opts ...Option) (*Publisher, error) {
	o := applyOptions(opts)

	// Declare the safety net first: galaxify.events points at galaxify.ae, so
	// the alternate exchange must already exist when that reference is made.
	err := channel.ExchangeDeclare(
		"galaxify.ae", // name
		"fanout",      // kind
		true,          // durable
		false,         // auto-delete
		false,         // internal
		false,         // no-wait
		nil,           // arguments
	)
	if err != nil {
		return nil, fmt.Errorf("failed to declare alternate exchange: %w", err)
	}

	_, err = channel.QueueDeclare(
		"galaxify.unroutable", // name
		true,                  // durable
		false,                 // auto-delete
		false,                 // exclusive
		false,                 // no-wait
		nil,                   // arguments
	)
	if err != nil {
		return nil, fmt.Errorf("failed to declare unroutable queue: %w", err)
	}

	err = channel.QueueBind(
		"galaxify.unroutable", // queue
		"",                    // routing key (a fanout exchange ignores it)
		"galaxify.ae",         // exchange
		false,                 // no-wait
		nil,                   // arguments
	)
	if err != nil {
		return nil, fmt.Errorf("failed to bind unroutable queue: %w", err)
	}

	err = channel.ExchangeDeclare(
		"galaxify.events", // name
		"topic",           // kind
		true,              // durable
		false,             // auto-delete
		false,             // internal
		false,             // no-wait
		amqp091.Table{"alternate-exchange": "galaxify.ae"}, // arguments
	)

	if err != nil {
		return nil, fmt.Errorf("failed to declare exchange: %w", err)
	}
	if err := channel.Confirm(false); err != nil {
		return nil, fmt.Errorf("enable publisher confirms: %w", err)
	}
	confirmations := channel.NotifyPublish(make(chan amqp091.Confirmation, 1))

	return &Publisher{channel: channel, confirmations: confirmations, logger: o.logger}, nil
}

func (p *Publisher) Publish(ctx context.Context, eventType string, payload any, opts ...PublishOption) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	o := applyPublishOptions(opts)
	eventID := o.eventID
	if eventID == "" {
		eventID = uuid.New().String()
	}
	occurredAt := o.occurredAt
	if occurredAt.IsZero() {
		occurredAt = time.Now()
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	envelope := Envelope{
		EventId:    eventID,
		EventType:  eventType,
		OccurredAt: occurredAt,
		Version:    1,
		Payload:    payloadBytes,
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
		props.Headers["x-request-id"] = requestID
	}

	expectedDeliveryTag := p.channel.GetNextPublishSeqNo()
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
	for {
		select {
		case confirmation, ok := <-p.confirmations:
			if !ok {
				return errors.New("publisher confirmation channel closed")
			}
			if confirmation.DeliveryTag < expectedDeliveryTag {
				continue
			}
			if confirmation.DeliveryTag != expectedDeliveryTag {
				return fmt.Errorf("unexpected publisher confirmation tag: got %d, want %d", confirmation.DeliveryTag, expectedDeliveryTag)
			}
			if !confirmation.Ack {
				return errors.New("broker rejected event")
			}
		case <-ctx.Done():
			return fmt.Errorf("wait for publisher confirmation: %w", ctx.Err())
		}
		break
	}

	p.logger.Debug("event published",
		"event_id", eventID,
		"event_type", eventType,
	)

	return nil
}

func (p *Publisher) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.channel.Close()
}
