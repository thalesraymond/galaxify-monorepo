package events

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/rabbitmq/amqp091-go"
)

// fakeSubscriberChannel is a stand-in for *amqp091.Channel that records calls
// and lets tests inject deliveries. Cancel closes the delivery channel, which
// mimics real RabbitMQ and lets the consumer goroutine's range loop exit.
type fakeSubscriberChannel struct {
	mu sync.Mutex

	queues      map[string]amqp091.Queue
	bound       []string
	consumedFor []string
	deliveries  chan amqp091.Delivery

	declareErr error
	bindErr    error
	consumeErr error
	cancelErr  error
	closeErr   error

	cancelled bool
	closed    bool
}

func newFakeSubscriberChannel() *fakeSubscriberChannel {
	return &fakeSubscriberChannel{
		queues:     make(map[string]amqp091.Queue),
		deliveries: make(chan amqp091.Delivery),
	}
}

func (f *fakeSubscriberChannel) QueueDeclare(name string, durable, autoDelete, exclusive, noWait bool, args amqp091.Table) (amqp091.Queue, error) {
	if f.declareErr != nil {
		return amqp091.Queue{}, f.declareErr
	}
	q := amqp091.Queue{Name: name}
	f.mu.Lock()
	f.queues[name] = q
	f.mu.Unlock()
	return q, nil
}

func (f *fakeSubscriberChannel) QueueBind(name, key, exchange string, noWait bool, args amqp091.Table) error {
	if f.bindErr != nil {
		return f.bindErr
	}
	f.mu.Lock()
	f.bound = append(f.bound, name+"->"+key)
	f.mu.Unlock()
	return nil
}

func (f *fakeSubscriberChannel) Consume(queue, consumer string, autoAck, exclusive, noLocal, noWait bool, args amqp091.Table) (<-chan amqp091.Delivery, error) {
	if f.consumeErr != nil {
		return nil, f.consumeErr
	}
	f.mu.Lock()
	f.consumedFor = append(f.consumedFor, queue)
	f.mu.Unlock()
	return f.deliveries, nil
}

func (f *fakeSubscriberChannel) Cancel(consumer string, noWait bool) error {
	if f.cancelErr != nil {
		return f.cancelErr
	}
	f.mu.Lock()
	f.cancelled = true
	f.mu.Unlock()
	close(f.deliveries)
	return nil
}

func (f *fakeSubscriberChannel) Close() error {
	f.mu.Lock()
	f.closed = true
	f.mu.Unlock()
	return f.closeErr
}

// fakeAcknowledger records whether a delivery was acked or nacked. The
// channels let tests wait deterministically for the consumer goroutine to
// settle. It satisfies amqp091.Acknowledger, which Delivery.Ack/Nack delegate
// to.
type fakeAcknowledger struct {
	acked   chan struct{}
	nacked  chan struct{}
	requeue bool
}

func newFakeAcknowledger() *fakeAcknowledger {
	return &fakeAcknowledger{
		acked:  make(chan struct{}),
		nacked: make(chan struct{}),
	}
}

func (f *fakeAcknowledger) Ack(tag uint64, multiple bool) error {
	close(f.acked)
	return nil
}

func (f *fakeAcknowledger) Nack(tag uint64, multiple bool, requeue bool) error {
	f.requeue = requeue
	close(f.nacked)
	return nil
}

func (f *fakeAcknowledger) Reject(tag uint64, requeue bool) error {
	return nil
}

// shutdownSubscriber stops a started subscriber so its consumer goroutines
// don't leak past the test.
func shutdownSubscriber(t *testing.T, s *Subscriber) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := s.Shutdown(ctx); err != nil {
		t.Errorf("Shutdown returned error: %v", err)
	}
}

func TestNewSubscriber(t *testing.T) {
	s, err := NewSubscriber(newFakeSubscriberChannel(), "daily-service")
	if err != nil {
		t.Fatalf("NewSubscriber returned error: %v", err)
	}
	if s == nil {
		t.Fatal("expected non-nil Subscriber")
	}
	if s.serviceName != "daily-service" {
		t.Errorf("service name = %q, want %q", s.serviceName, "daily-service")
	}
	if s.logger != slog.Default() {
		t.Error("expected default logger to be slog.Default()")
	}
}

func TestNewSubscriberWithLogger(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	s, err := NewSubscriber(newFakeSubscriberChannel(), "daily-service", WithLogger(logger))
	if err != nil {
		t.Fatalf("NewSubscriber returned error: %v", err)
	}
	if s.logger != logger {
		t.Error("expected custom logger to be set")
	}
}

func TestSubscriberOn(t *testing.T) {
	s, err := NewSubscriber(newFakeSubscriberChannel(), "daily-service")
	if err != nil {
		t.Fatalf("NewSubscriber returned error: %v", err)
	}

	handler := func(ctx context.Context, eventType string, payload []byte) error { return nil }
	s.On("user.created", handler)

	s.mu.RLock()
	got, ok := s.handlers["user.created"]
	s.mu.RUnlock()
	if !ok {
		t.Fatal("expected handler registered for user.created")
	}
	if got == nil {
		t.Fatal("expected non-nil handler")
	}
}

func TestSubscriberStart(t *testing.T) {
	t.Run("no handlers returns without consuming", func(t *testing.T) {
		ch := newFakeSubscriberChannel()
		s, err := NewSubscriber(ch, "daily-service")
		if err != nil {
			t.Fatalf("NewSubscriber returned error: %v", err)
		}

		if err := s.Start(context.Background()); err != nil {
			t.Fatalf("Start returned error: %v", err)
		}

		ch.mu.Lock()
		defer ch.mu.Unlock()
		if len(ch.consumedFor) != 0 {
			t.Errorf("expected no consumers, got %v", ch.consumedFor)
		}
	})

	t.Run("declares queue and consumes for each handler", func(t *testing.T) {
		ch := newFakeSubscriberChannel()
		s, err := NewSubscriber(ch, "daily-service")
		if err != nil {
			t.Fatalf("NewSubscriber returned error: %v", err)
		}
		defer shutdownSubscriber(t, s)

		s.On("user.created", func(ctx context.Context, eventType string, payload []byte) error { return nil })
		s.On("daily.completed", func(ctx context.Context, eventType string, payload []byte) error { return nil })

		if err := s.Start(context.Background()); err != nil {
			t.Fatalf("Start returned error: %v", err)
		}

		ch.mu.Lock()
		defer ch.mu.Unlock()
		if len(ch.queues) != 2 {
			t.Errorf("expected 2 queues declared, got %d", len(ch.queues))
		}
		if _, ok := ch.queues["daily-service.user.created"]; !ok {
			t.Error("expected queue daily-service.user.created")
		}
		if _, ok := ch.queues["daily-service.daily.completed"]; !ok {
			t.Error("expected queue daily-service.daily.completed")
		}
		if len(ch.bound) != 2 {
			t.Errorf("expected 2 bindings, got %d", len(ch.bound))
		}
		if len(ch.consumedFor) != 2 {
			t.Errorf("expected 2 consumers, got %d", len(ch.consumedFor))
		}
	})

	t.Run("returns error when consume fails", func(t *testing.T) {
		wantErr := errors.New("consume failed")
		ch := newFakeSubscriberChannel()
		ch.consumeErr = wantErr
		s, err := NewSubscriber(ch, "daily-service")
		if err != nil {
			t.Fatalf("NewSubscriber returned error: %v", err)
		}
		s.On("user.created", func(ctx context.Context, eventType string, payload []byte) error { return nil })

		if err := s.Start(context.Background()); !errors.Is(err, wantErr) {
			t.Fatalf("expected consume error %v, got %v", wantErr, err)
		}
	})
}

func TestSubscriberDispatch(t *testing.T) {
	t.Run("calls handler and acks on success", func(t *testing.T) {
		ch := newFakeSubscriberChannel()
		s, err := NewSubscriber(ch, "daily-service")
		if err != nil {
			t.Fatalf("NewSubscriber returned error: %v", err)
		}
		defer shutdownSubscriber(t, s)

		handlerDone := make(chan struct{})
		var gotType string
		var gotPayload []byte
		s.On("user.created", func(ctx context.Context, eventType string, payload []byte) error {
			gotType = eventType
			gotPayload = payload
			close(handlerDone)
			return nil
		})

		if err := s.Start(context.Background()); err != nil {
			t.Fatalf("Start returned error: %v", err)
		}

		rec := newFakeAcknowledger()
		body := []byte(`{"event_id":"abc"}`)
		ch.deliveries <- amqp091.Delivery{RoutingKey: "user.created", Body: body, Acknowledger: rec}

		<-handlerDone
		<-rec.acked

		if gotType != "user.created" {
			t.Errorf("handler event type = %q, want %q", gotType, "user.created")
		}
		if string(gotPayload) != string(body) {
			t.Errorf("handler payload = %q, want %q", gotPayload, body)
		}
	})

	t.Run("nacks and requeues unknown event", func(t *testing.T) {
		ch := newFakeSubscriberChannel()
		s, err := NewSubscriber(ch, "daily-service")
		if err != nil {
			t.Fatalf("NewSubscriber returned error: %v", err)
		}
		defer shutdownSubscriber(t, s)

		s.On("user.created", func(ctx context.Context, eventType string, payload []byte) error { return nil })

		if err := s.Start(context.Background()); err != nil {
			t.Fatalf("Start returned error: %v", err)
		}

		rec := newFakeAcknowledger()
		ch.deliveries <- amqp091.Delivery{RoutingKey: "unknown.event", Body: []byte(`{}`), Acknowledger: rec}

		<-rec.nacked
		if !rec.requeue {
			t.Error("expected nack with requeue=true")
		}
	})

	t.Run("nacks and requeues on handler error", func(t *testing.T) {
		ch := newFakeSubscriberChannel()
		s, err := NewSubscriber(ch, "daily-service")
		if err != nil {
			t.Fatalf("NewSubscriber returned error: %v", err)
		}
		defer shutdownSubscriber(t, s)

		s.On("user.created", func(ctx context.Context, eventType string, payload []byte) error {
			return errors.New("handler boom")
		})

		if err := s.Start(context.Background()); err != nil {
			t.Fatalf("Start returned error: %v", err)
		}

		rec := newFakeAcknowledger()
		ch.deliveries <- amqp091.Delivery{RoutingKey: "user.created", Body: []byte(`{}`), Acknowledger: rec}

		<-rec.nacked
		if !rec.requeue {
			t.Error("expected nack with requeue=true")
		}
	})

	t.Run("propagates request id from headers to handler context", func(t *testing.T) {
		ch := newFakeSubscriberChannel()
		s, err := NewSubscriber(ch, "daily-service")
		if err != nil {
			t.Fatalf("NewSubscriber returned error: %v", err)
		}
		defer shutdownSubscriber(t, s)

		handlerDone := make(chan struct{})
		var gotRequestID string
		s.On("user.created", func(ctx context.Context, eventType string, payload []byte) error {
			gotRequestID = RequestIDFromContext(ctx)
			close(handlerDone)
			return nil
		})

		if err := s.Start(context.Background()); err != nil {
			t.Fatalf("Start returned error: %v", err)
		}

		rec := newFakeAcknowledger()
		ch.deliveries <- amqp091.Delivery{
			RoutingKey:   "user.created",
			Body:         []byte(`{}`),
			Headers:      amqp091.Table{"X-Request-ID": "req-456"},
			Acknowledger: rec,
		}

		<-handlerDone
		<-rec.acked

		if gotRequestID != "req-456" {
			t.Errorf("request id = %q, want %q", gotRequestID, "req-456")
		}
	})
}

func TestSubscriberShutdown(t *testing.T) {
	t.Run("cancels consumer and closes channel", func(t *testing.T) {
		ch := newFakeSubscriberChannel()
		s, err := NewSubscriber(ch, "daily-service")
		if err != nil {
			t.Fatalf("NewSubscriber returned error: %v", err)
		}
		s.On("user.created", func(ctx context.Context, eventType string, payload []byte) error { return nil })

		if err := s.Start(context.Background()); err != nil {
			t.Fatalf("Start returned error: %v", err)
		}

		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := s.Shutdown(ctx); err != nil {
			t.Fatalf("Shutdown returned error: %v", err)
		}

		ch.mu.Lock()
		defer ch.mu.Unlock()
		if !ch.cancelled {
			t.Error("expected consumer to be cancelled")
		}
		if !ch.closed {
			t.Error("expected channel to be closed")
		}
	})

	t.Run("waits for in-flight handler", func(t *testing.T) {
		ch := newFakeSubscriberChannel()
		s, err := NewSubscriber(ch, "daily-service")
		if err != nil {
			t.Fatalf("NewSubscriber returned error: %v", err)
		}

		handlerStarted := make(chan struct{})
		releaseHandler := make(chan struct{})
		s.On("user.created", func(ctx context.Context, eventType string, payload []byte) error {
			close(handlerStarted)
			<-releaseHandler
			return nil
		})

		if err := s.Start(context.Background()); err != nil {
			t.Fatalf("Start returned error: %v", err)
		}

		rec := newFakeAcknowledger()
		ch.deliveries <- amqp091.Delivery{RoutingKey: "user.created", Body: []byte(`{}`), Acknowledger: rec}
		<-handlerStarted

		// Shutdown must block until the in-flight handler finishes.
		shutdownDone := make(chan struct{})
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			_ = s.Shutdown(ctx)
			close(shutdownDone)
		}()

		select {
		case <-shutdownDone:
			t.Fatal("Shutdown returned before in-flight handler finished")
		case <-time.After(50 * time.Millisecond):
		}

		close(releaseHandler)
		<-shutdownDone
		<-rec.acked
	})
}
