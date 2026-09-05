package events

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/rabbitmq/amqp091-go"

	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// publisherExchangeDeclare captures one ExchangeDeclare call made on a
// fakePublisherChannel, in the order it was made.
type publisherExchangeDeclare struct {
	name, kind          string
	durable, autoDelete bool
	internal, noWait    bool
	args                amqp091.Table
}

// publisherQueueDeclare captures one QueueDeclare call.
type publisherQueueDeclare struct {
	name                string
	durable, autoDelete bool
	exclusive, noWait   bool
	args                amqp091.Table
}

// publisherQueueBind captures one QueueBind call.
type publisherQueueBind struct {
	name, key, exchange string
	args                amqp091.Table
}

// fakePublisherChannel is a stand-in for *amqp091.Channel that records calls.
type fakePublisherChannel struct {
	aeDeclareErr     error
	eventsDeclareErr error
	queueDeclareErr  error
	queueBindErr     error
	publishErr       error
	closeErr         error

	exchangeDeclares []publisherExchangeDeclare
	queueDeclares    []publisherQueueDeclare
	queueBinds       []publisherQueueBind
	routingKeys      []string
	published        []amqp091.Publishing
	closed           bool
}

// Compile-time assertion that the fake still satisfies the real interface.
var _ PublisherChannel = (*fakePublisherChannel)(nil)

func (f *fakePublisherChannel) ExchangeDeclare(name, kind string, durable, autoDelete, internal, noWait bool, args amqp091.Table) error {
	f.exchangeDeclares = append(f.exchangeDeclares, publisherExchangeDeclare{
		name:       name,
		kind:       kind,
		durable:    durable,
		autoDelete: autoDelete,
		internal:   internal,
		noWait:     noWait,
		args:       args,
	})

	switch name {
	case "galaxify.ae":
		return f.aeDeclareErr
	case "galaxify.events":
		return f.eventsDeclareErr
	default:
		// Fail loudly on any other exchange: silently returning nil here would
		// let an unverified ExchangeDeclare pass for free.
		return errors.New("fakePublisherChannel: unexpected ExchangeDeclare for " + name)
	}
}

func (f *fakePublisherChannel) QueueDeclare(name string, durable, autoDelete, exclusive, noWait bool, args amqp091.Table) (amqp091.Queue, error) {
	f.queueDeclares = append(f.queueDeclares, publisherQueueDeclare{
		name:       name,
		durable:    durable,
		autoDelete: autoDelete,
		exclusive:  exclusive,
		noWait:     noWait,
		args:       args,
	})
	return amqp091.Queue{Name: name}, f.queueDeclareErr
}

func (f *fakePublisherChannel) QueueBind(name, key, exchange string, noWait bool, args amqp091.Table) error {
	f.queueBinds = append(f.queueBinds, publisherQueueBind{
		name:     name,
		key:      key,
		exchange: exchange,
		args:     args,
	})
	return f.queueBindErr
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

// findExchangeDeclare returns the recorded declaration for the named exchange,
// failing the test when that exchange was never declared.
func findExchangeDeclare(t *testing.T, ch *fakePublisherChannel, name string) publisherExchangeDeclare {
	t.Helper()

	for _, decl := range ch.exchangeDeclares {
		if decl.name == name {
			return decl
		}
	}

	t.Fatalf("exchange %q was never declared; declares = %v", name, exchangeDeclareNames(ch))
	return publisherExchangeDeclare{}
}

// findQueueDeclare returns the recorded declaration for the named queue,
// failing the test when that queue was never declared.
func findQueueDeclare(t *testing.T, ch *fakePublisherChannel, name string) publisherQueueDeclare {
	t.Helper()

	for _, decl := range ch.queueDeclares {
		if decl.name == name {
			return decl
		}
	}

	t.Fatalf("queue %q was never declared; declares = %v", name, queueDeclareNames(ch))
	return publisherQueueDeclare{}
}

// exchangeDeclareIndex returns the position of the named exchange in the
// recorded declare order, or -1 when it was never declared.
func exchangeDeclareIndex(ch *fakePublisherChannel, name string) int {
	for i, decl := range ch.exchangeDeclares {
		if decl.name == name {
			return i
		}
	}
	return -1
}

func exchangeDeclareNames(ch *fakePublisherChannel) []string {
	names := make([]string, 0, len(ch.exchangeDeclares))
	for _, decl := range ch.exchangeDeclares {
		names = append(names, decl.name)
	}
	return names
}

func queueDeclareNames(ch *fakePublisherChannel) []string {
	names := make([]string, 0, len(ch.queueDeclares))
	for _, decl := range ch.queueDeclares {
		names = append(names, decl.name)
	}
	return names
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

		events := findExchangeDeclare(t, ch, "galaxify.events")
		if events.kind != "topic" {
			t.Errorf("galaxify.events kind = %q, want %q", events.kind, "topic")
		}
		if !events.durable {
			t.Error("galaxify.events should be durable")
		}
		if events.autoDelete || events.internal || events.noWait {
			t.Errorf("galaxify.events flags = autoDelete %v internal %v noWait %v, want all false",
				events.autoDelete, events.internal, events.noWait)
		}

		alt, ok := events.args["alternate-exchange"]
		if !ok {
			t.Fatalf("galaxify.events args = %v, want an alternate-exchange entry", events.args)
		}
		if alt != "galaxify.ae" {
			t.Errorf("alternate-exchange = %v, want %q", alt, "galaxify.ae")
		}

		// The alternate exchange must exist before the main exchange points at it.
		aeIndex := exchangeDeclareIndex(ch, "galaxify.ae")
		eventsIndex := exchangeDeclareIndex(ch, "galaxify.events")
		if aeIndex < 0 {
			t.Fatal("expected galaxify.ae to be declared before galaxify.events")
		}
		if aeIndex > eventsIndex {
			t.Errorf("galaxify.ae declared at index %d, want it before galaxify.events at index %d",
				aeIndex, eventsIndex)
		}
	})

	t.Run("declares the alternate exchange as durable fanout", func(t *testing.T) {
		ch := &fakePublisherChannel{}
		if _, err := NewPublisher(ch); err != nil {
			t.Fatalf("NewPublisher returned error: %v", err)
		}

		ae := findExchangeDeclare(t, ch, "galaxify.ae")
		if ae.kind != "fanout" {
			t.Errorf("galaxify.ae kind = %q, want %q", ae.kind, "fanout")
		}
		if !ae.durable {
			t.Error("galaxify.ae should be durable")
		}
		if ae.autoDelete || ae.internal || ae.noWait {
			t.Errorf("galaxify.ae flags = autoDelete %v internal %v noWait %v, want all false",
				ae.autoDelete, ae.internal, ae.noWait)
		}
		if len(ae.args) != 0 {
			t.Errorf("galaxify.ae args = %v, want none", ae.args)
		}
	})

	t.Run("declares the unroutable queue", func(t *testing.T) {
		ch := &fakePublisherChannel{}
		if _, err := NewPublisher(ch); err != nil {
			t.Fatalf("NewPublisher returned error: %v", err)
		}

		if len(ch.queueDeclares) != 1 {
			t.Fatalf("queue declares = %v, want exactly one", queueDeclareNames(ch))
		}
		unroutable := findQueueDeclare(t, ch, "galaxify.unroutable")
		if !unroutable.durable {
			t.Error("galaxify.unroutable should be durable")
		}
		if unroutable.autoDelete || unroutable.exclusive || unroutable.noWait {
			t.Errorf("galaxify.unroutable flags = autoDelete %v exclusive %v noWait %v, want all false",
				unroutable.autoDelete, unroutable.exclusive, unroutable.noWait)
		}
		if len(unroutable.args) != 0 {
			t.Errorf("galaxify.unroutable args = %v, want none", unroutable.args)
		}
	})

	t.Run("binds the unroutable queue to the alternate exchange", func(t *testing.T) {
		ch := &fakePublisherChannel{}
		if _, err := NewPublisher(ch); err != nil {
			t.Fatalf("NewPublisher returned error: %v", err)
		}

		if len(ch.queueBinds) != 1 {
			t.Fatalf("queue binds = %d, want 1", len(ch.queueBinds))
		}
		bind := ch.queueBinds[0]
		if bind.name != "galaxify.unroutable" {
			t.Errorf("bound queue = %q, want %q", bind.name, "galaxify.unroutable")
		}
		if bind.exchange != "galaxify.ae" {
			t.Errorf("bound exchange = %q, want %q", bind.exchange, "galaxify.ae")
		}
		// A fanout exchange ignores the routing key, so it must be empty.
		if bind.key != "" {
			t.Errorf("routing key = %q, want empty", bind.key)
		}
		if len(bind.args) != 0 {
			t.Errorf("bind args = %v, want none", bind.args)
		}
	})

	t.Run("returns error when exchange declare fails", func(t *testing.T) {
		wantErr := errors.New("declare failed")
		ch := &fakePublisherChannel{eventsDeclareErr: wantErr}
		if _, err := NewPublisher(ch); !errors.Is(err, wantErr) {
			t.Fatalf("expected declare error %v, got %v", wantErr, err)
		}
	})

	t.Run("returns error from each topology step", func(t *testing.T) {
		tests := []struct {
			name    string
			inject  func(ch *fakePublisherChannel, err error)
			wantMsg string
		}{
			{
				name:    "alternate exchange declare",
				inject:  func(ch *fakePublisherChannel, err error) { ch.aeDeclareErr = err },
				wantMsg: "failed to declare alternate exchange",
			},
			{
				name:    "unroutable queue declare",
				inject:  func(ch *fakePublisherChannel, err error) { ch.queueDeclareErr = err },
				wantMsg: "failed to declare unroutable queue",
			},
			{
				name:    "unroutable queue bind",
				inject:  func(ch *fakePublisherChannel, err error) { ch.queueBindErr = err },
				wantMsg: "failed to bind unroutable queue",
			},
			{
				name:    "events exchange declare",
				inject:  func(ch *fakePublisherChannel, err error) { ch.eventsDeclareErr = err },
				wantMsg: "failed to declare exchange",
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				wantErr := errors.New("broker unavailable")
				ch := &fakePublisherChannel{}
				tt.inject(ch, wantErr)

				p, err := NewPublisher(ch)
				if p != nil {
					t.Errorf("expected nil Publisher, got %v", p)
				}
				if !errors.Is(err, wantErr) {
					t.Fatalf("expected error wrapping %v, got %v", wantErr, err)
				}
				if !strings.Contains(err.Error(), tt.wantMsg) {
					t.Errorf("error = %q, want it to mention %q", err.Error(), tt.wantMsg)
				}
			})
		}
	})

	t.Run("stops before galaxify.events when the safety net fails", func(t *testing.T) {
		ch := &fakePublisherChannel{aeDeclareErr: errors.New("declare failed")}
		if _, err := NewPublisher(ch); err == nil {
			t.Fatal("expected NewPublisher to return an error")
		}
		if exchangeDeclareIndex(ch, "galaxify.events") != -1 {
			t.Errorf("galaxify.events declared after the alternate exchange failed; declares = %v",
				exchangeDeclareNames(ch))
		}

		ch = &fakePublisherChannel{queueBindErr: errors.New("bind failed")}
		if _, err := NewPublisher(ch); err == nil {
			t.Fatal("expected NewPublisher to return an error")
		}
		if exchangeDeclareIndex(ch, "galaxify.events") != -1 {
			t.Errorf("galaxify.events declared after the unroutable bind failed; declares = %v",
				exchangeDeclareNames(ch))
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

		ctx := sharedhttp.WithRequestID(context.Background(), "req-123")
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
