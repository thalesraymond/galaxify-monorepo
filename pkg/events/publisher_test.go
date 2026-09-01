package events

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/rabbitmq/amqp091-go"
)

// fakePublisherChannel is a stand-in for *amqp091.Channel that records calls.
type fakePublisherChannel struct {
	declareErr error
	publishErr error
	closeErr   error

	declaredName string
	declaredKind string
	routingKeys  []string
	published    []amqp091.Publishing
	closed       bool
}

func (f *fakePublisherChannel) ExchangeDeclare(name, kind string, durable, autoDelete, internal, noWait bool, args amqp091.Table) error {
	f.declaredName = name
	f.declaredKind = kind
	return f.declareErr
}

func (f *fakePublisherChannel) Publish(exchange, key string, mandatory, immediate bool, msg amqp091.Publishing) error {
	f.routingKeys = append(f.routingKeys, key)
	f.published = append(f.published, msg)
	return f.publishErr
}

func (f *fakePublisherChannel) Close() error {
	f.closed = true
	return f.closeErr
}

func TestNewPublisher(t *testing.T) {
	t.Run("declares the topic exchange", func(t *testing.T) {
		ch := &fakePublisherChannel{}
		p, err := NewPublisher(ch)
		if err != nil {
			t.Fatalf("NewPublisher returned error: %v", err)
		}
		if p == nil {
			t.Fatal("expected non-nil Publisher")
		}
		if ch.declaredName != "galaxify.events" {
			t.Errorf("exchange name = %q, want %q", ch.declaredName, "galaxify.events")
		}
		if ch.declaredKind != "topic" {
			t.Errorf("exchange kind = %q, want %q", ch.declaredKind, "topic")
		}
	})

	t.Run("returns error when exchange declare fails", func(t *testing.T) {
		wantErr := errors.New("declare failed")
		ch := &fakePublisherChannel{declareErr: wantErr}
		if _, err := NewPublisher(ch); !errors.Is(err, wantErr) {
			t.Fatalf("expected declare error %v, got %v", wantErr, err)
		}
	})

	t.Run("defaults to slog.Default logger", func(t *testing.T) {
		ch := &fakePublisherChannel{}
		p, err := NewPublisher(ch)
		if err != nil {
			t.Fatalf("NewPublisher returned error: %v", err)
		}
		if p.logger != slog.Default() {
			t.Error("expected default logger to be slog.Default()")
		}
	})

	t.Run("uses custom logger when provided", func(t *testing.T) {
		ch := &fakePublisherChannel{}
		logger := slog.New(slog.NewTextHandler(io.Discard, nil))
		p, err := NewPublisher(ch, WithLogger(logger))
		if err != nil {
			t.Fatalf("NewPublisher returned error: %v", err)
		}
		if p.logger != logger {
			t.Error("expected custom logger to be set")
		}
	})
}

func TestPublisherPublish(t *testing.T) {
	t.Run("publishes envelope with routing key", func(t *testing.T) {
		ch := &fakePublisherChannel{}
		p, err := NewPublisher(ch)
		if err != nil {
			t.Fatalf("NewPublisher returned error: %v", err)
		}

		if err := p.Publish(context.Background(), "user.created", map[string]string{"user_id": "123"}); err != nil {
			t.Fatalf("Publish returned error: %v", err)
		}

		if len(ch.published) != 1 {
			t.Fatalf("expected 1 publish, got %d", len(ch.published))
		}
		if ch.routingKeys[0] != "user.created" {
			t.Errorf("routing key = %q, want %q", ch.routingKeys[0], "user.created")
		}

		msg := ch.published[0]
		if msg.ContentType != "application/json" {
			t.Errorf("content type = %q, want %q", msg.ContentType, "application/json")
		}
		if msg.DeliveryMode != amqp091.Persistent {
			t.Errorf("delivery mode = %d, want %d", msg.DeliveryMode, amqp091.Persistent)
		}

		var env Envelope
		if err := json.Unmarshal(msg.Body, &env); err != nil {
			t.Fatalf("failed to unmarshal envelope: %v", err)
		}
		if env.EventType != "user.created" {
			t.Errorf("envelope event_type = %q, want %q", env.EventType, "user.created")
		}
		if env.EventId == "" {
			t.Error("expected non-empty event_id")
		}
		if env.Version != 1 {
			t.Errorf("envelope version = %d, want 1", env.Version)
		}
	})

	t.Run("propagates request id header", func(t *testing.T) {
		ch := &fakePublisherChannel{}
		p, err := NewPublisher(ch)
		if err != nil {
			t.Fatalf("NewPublisher returned error: %v", err)
		}

		ctx := WithRequestID(context.Background(), "req-123")
		if err := p.Publish(ctx, "user.created", nil); err != nil {
			t.Fatalf("Publish returned error: %v", err)
		}

		got, ok := ch.published[0].Headers["X-Request-ID"]
		if !ok {
			t.Fatal("expected X-Request-ID header")
		}
		if got != "req-123" {
			t.Errorf("X-Request-ID = %v, want %q", got, "req-123")
		}
	})

	t.Run("omits request id header when absent", func(t *testing.T) {
		ch := &fakePublisherChannel{}
		p, err := NewPublisher(ch)
		if err != nil {
			t.Fatalf("NewPublisher returned error: %v", err)
		}

		if err := p.Publish(context.Background(), "user.created", nil); err != nil {
			t.Fatalf("Publish returned error: %v", err)
		}
		if _, ok := ch.published[0].Headers["X-Request-ID"]; ok {
			t.Error("expected no X-Request-ID header")
		}
	})

	t.Run("returns error when publish fails", func(t *testing.T) {
		wantErr := errors.New("publish failed")
		ch := &fakePublisherChannel{publishErr: wantErr}
		p, err := NewPublisher(ch)
		if err != nil {
			t.Fatalf("NewPublisher returned error: %v", err)
		}

		if err := p.Publish(context.Background(), "user.created", nil); !errors.Is(err, wantErr) {
			t.Fatalf("expected publish error %v, got %v", wantErr, err)
		}
	})
}

func TestPublisherClose(t *testing.T) {
	t.Run("closes the channel", func(t *testing.T) {
		ch := &fakePublisherChannel{}
		p, err := NewPublisher(ch)
		if err != nil {
			t.Fatalf("NewPublisher returned error: %v", err)
		}

		if err := p.Close(); err != nil {
			t.Fatalf("Close returned error: %v", err)
		}
		if !ch.closed {
			t.Error("expected channel to be closed")
		}
	})

	t.Run("returns close error", func(t *testing.T) {
		wantErr := errors.New("close failed")
		ch := &fakePublisherChannel{closeErr: wantErr}
		p, err := NewPublisher(ch)
		if err != nil {
			t.Fatalf("NewPublisher returned error: %v", err)
		}

		if err := p.Close(); !errors.Is(err, wantErr) {
			t.Fatalf("expected close error %v, got %v", wantErr, err)
		}
	})
}
