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

	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

// Dead-letter topology names under test (ADR-0009). Kept local to the test
// package so the production code uses inline literals like the rest of the
// file.
const (
	dlxExchangeName      = "galaxify.dlx"
	deadLettersQueueName = "galaxify.dead_letters"
	deadLetterArgName    = "x-dead-letter-exchange"
	eventsExchangeName   = "galaxify.events"
)

// subscriberExchangeDeclare, subscriberQueueDeclare and subscriberQueueBind capture
// the AMQP setup calls made through fakeSubscriberChannel so tests can assert
// on exchange/queue arguments, not just call counts.
type subscriberExchangeDeclare struct {
	name, kind          string
	durable, autoDelete bool
	internal, noWait    bool
	args                amqp091.Table
}

type subscriberQueueDeclare struct {
	name                string
	durable, autoDelete bool
	exclusive, noWait   bool
	args                amqp091.Table
}

type subscriberQueueBind struct {
	name, key, exchange string
	noWait              bool
	args                amqp091.Table
}

// fakeSubscriberChannel is a stand-in for *amqp091.Channel that records calls
// and lets tests inject deliveries. Cancel closes the delivery channel, which
// mimics real RabbitMQ and lets the consumer goroutine's range loop exit.
type fakeSubscriberChannel struct {
	mu sync.Mutex

	queues           map[string]amqp091.Queue
	bound            []string
	binds            []subscriberQueueBind
	consumedFor      []string
	deliveries       chan amqp091.Delivery
	exchangeDeclares []subscriberExchangeDeclare
	queueDeclares    []subscriberQueueDeclare

	// Error injection. declareErr/bindErr apply to any queue declare/bind; the
	// deadLetters* ones only fire for the global dead-letter topology so tests
	// can exercise each failure step independently.
	declareErr            error
	deadLettersDeclareErr error
	bindErr               error
	deadLettersBindErr    error
	exchangeDeclareErr    error
	consumeErr            error
	cancelErr             error
	closeErr              error

	cancelled bool
	closed    bool
}

func newFakeSubscriberChannel() *fakeSubscriberChannel {
	return &fakeSubscriberChannel{
		queues:     make(map[string]amqp091.Queue),
		deliveries: make(chan amqp091.Delivery),
	}
}

func (f *fakeSubscriberChannel) ExchangeDeclare(name, kind string, durable, autoDelete, internal, noWait bool, args amqp091.Table) error {
	if f.exchangeDeclareErr != nil {
		return f.exchangeDeclareErr
	}
	f.mu.Lock()
	f.exchangeDeclares = append(f.exchangeDeclares, subscriberExchangeDeclare{
		name:       name,
		kind:       kind,
		durable:    durable,
		autoDelete: autoDelete,
		internal:   internal,
		noWait:     noWait,
		args:       args,
	})
	f.mu.Unlock()
	return nil
}

func (f *fakeSubscriberChannel) QueueDeclare(name string, durable, autoDelete, exclusive, noWait bool, args amqp091.Table) (amqp091.Queue, error) {
	if name == deadLettersQueueName && f.deadLettersDeclareErr != nil {
		return amqp091.Queue{}, f.deadLettersDeclareErr
	}
	if f.declareErr != nil {
		return amqp091.Queue{}, f.declareErr
	}
	q := amqp091.Queue{Name: name}
	f.mu.Lock()
	f.queues[name] = q
	f.queueDeclares = append(f.queueDeclares, subscriberQueueDeclare{
		name:       name,
		durable:    durable,
		autoDelete: autoDelete,
		exclusive:  exclusive,
		noWait:     noWait,
		args:       args,
	})
	f.mu.Unlock()
	return q, nil
}

func (f *fakeSubscriberChannel) QueueBind(name, key, exchange string, noWait bool, args amqp091.Table) error {
	if exchange == dlxExchangeName && f.deadLettersBindErr != nil {
		return f.deadLettersBindErr
	}
	if f.bindErr != nil {
		return f.bindErr
	}
	f.mu.Lock()
	f.bound = append(f.bound, name+"->"+key)
	f.binds = append(f.binds, subscriberQueueBind{
		name:     name,
		key:      key,
		exchange: exchange,
		noWait:   noWait,
		args:     args,
	})
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

// lookup helpers. They lock internally, so callers must not already hold
// f.mu; they report whether the recorded call exists.

func exchangeDeclareByName(ch *fakeSubscriberChannel, name string) (subscriberExchangeDeclare, bool) {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	for _, e := range ch.exchangeDeclares {
		if e.name == name {
			return e, true
		}
	}
	return subscriberExchangeDeclare{}, false
}

func queueDeclareByName(ch *fakeSubscriberChannel, name string) (subscriberQueueDeclare, bool) {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	for _, q := range ch.queueDeclares {
		if q.name == name {
			return q, true
		}
	}
	return subscriberQueueDeclare{}, false
}

func queueBindByNames(ch *fakeSubscriberChannel, name, exchange string) (subscriberQueueBind, bool) {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	for _, b := range ch.binds {
		if b.name == name && b.exchange == exchange {
			return b, true
		}
	}
	return subscriberQueueBind{}, false
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
	t.Run("constructs the subscriber with the default logger", func(t *testing.T) {
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
	})

	t.Run("declares the dead letter exchange and queue once", func(t *testing.T) {
		ch := newFakeSubscriberChannel()
		s, err := NewSubscriber(ch, "daily-service")
		if err != nil {
			t.Fatalf("NewSubscriber returned error: %v", err)
		}
		if s == nil {
			t.Fatal("expected non-nil Subscriber")
		}

		dlx, ok := exchangeDeclareByName(ch, dlxExchangeName)
		if !ok {
			t.Fatalf("expected %s to be declared, got exchange declares %v", dlxExchangeName, ch.exchangeDeclares)
		}
		if dlx.kind != "fanout" {
			t.Errorf("%s kind = %q, want %q", dlxExchangeName, dlx.kind, "fanout")
		}
		if !dlx.durable {
			t.Errorf("expected %s to be durable", dlxExchangeName)
		}
		if dlx.autoDelete || dlx.internal || dlx.noWait {
			t.Errorf("%s autoDelete/internal/noWait = %v/%v/%v, want all false", dlxExchangeName, dlx.autoDelete, dlx.internal, dlx.noWait)
		}
		if dlx.args != nil {
			t.Errorf("%s args = %v, want nil", dlxExchangeName, dlx.args)
		}

		deadLetters, ok := queueDeclareByName(ch, deadLettersQueueName)
		if !ok {
			t.Fatalf("expected queue %s to be declared", deadLettersQueueName)
		}
		if !deadLetters.durable {
			t.Errorf("expected queue %s to be durable", deadLettersQueueName)
		}
		if deadLetters.autoDelete || deadLetters.exclusive || deadLetters.noWait {
			t.Errorf("queue %s autoDelete/exclusive/noWait = %v/%v/%v, want all false", deadLettersQueueName, deadLetters.autoDelete, deadLetters.exclusive, deadLetters.noWait)
		}
		if _, ok := deadLetters.args[deadLetterArgName]; ok {
			t.Errorf("queue %s must not carry a %s argument, otherwise dead letters loop forever", deadLettersQueueName, deadLetterArgName)
		}

		bind, ok := queueBindByNames(ch, deadLettersQueueName, dlxExchangeName)
		if !ok {
			t.Fatalf("expected queue %s bound to exchange %s", deadLettersQueueName, dlxExchangeName)
		}
		// A fanout exchange ignores the binding routing key, so we expect "".
		if bind.key != "" {
			t.Errorf("bind routing key = %q, want %q", bind.key, "")
		}
		if bind.noWait {
			t.Error("expected bind with no-wait=false")
		}

		// Constructing a subscriber must not declare any service queue yet.
		if _, ok := queueDeclareByName(ch, "daily-service.user.created"); ok {
			t.Error("did not expect a service queue to be declared by NewSubscriber")
		}
	})

	t.Run("returns wrapped error when dead letter exchange declare fails", func(t *testing.T) {
		wantErr := errors.New("exchange declare failed")
		ch := newFakeSubscriberChannel()
		ch.exchangeDeclareErr = wantErr

		s, err := NewSubscriber(ch, "daily-service")
		if !errors.Is(err, wantErr) {
			t.Fatalf("expected exchange declare error %v, got %v", wantErr, err)
		}
		if s != nil {
			t.Error("expected nil Subscriber when the DLX declare fails")
		}
	})

	t.Run("returns wrapped error when dead letters queue declare fails", func(t *testing.T) {
		wantErr := errors.New("dead letters queue declare failed")
		ch := newFakeSubscriberChannel()
		ch.deadLettersDeclareErr = wantErr

		s, err := NewSubscriber(ch, "daily-service")
		if !errors.Is(err, wantErr) {
			t.Fatalf("expected dead letters declare error %v, got %v", wantErr, err)
		}
		if s != nil {
			t.Error("expected nil Subscriber when the dead letters queue declare fails")
		}
	})

	t.Run("returns wrapped error when dead letters queue bind fails", func(t *testing.T) {
		wantErr := errors.New("dead letters queue bind failed")
		ch := newFakeSubscriberChannel()
		ch.deadLettersBindErr = wantErr

		s, err := NewSubscriber(ch, "daily-service")
		if !errors.Is(err, wantErr) {
			t.Fatalf("expected dead letters bind error %v, got %v", wantErr, err)
		}
		if s != nil {
			t.Error("expected nil Subscriber when the dead letters queue bind fails")
		}
	})
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

	t.Run("declares dead letter args for each handler queue", func(t *testing.T) {
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

		// Service queues plus the global dead letters queue.
		ch.mu.Lock()
		queueNames := make([]string, 0, len(ch.queues))
		for name := range ch.queues {
			queueNames = append(queueNames, name)
		}
		bindingCount := len(ch.bound)
		consumerCount := len(ch.consumedFor)
		ch.mu.Unlock()

		if len(queueNames) != 3 {
			t.Errorf("expected 3 queues declared (2 service + %s), got %d: %v", deadLettersQueueName, len(queueNames), queueNames)
		}
		for _, want := range []string{"daily-service.user.created", "daily-service.daily.completed", deadLettersQueueName} {
			if _, ok := queueDeclareByName(ch, want); !ok {
				t.Errorf("expected queue %s to be declared, got %v", want, queueNames)
			}
		}
		if bindingCount != 3 {
			t.Errorf("expected 3 bindings (2 service + dead letters), got %d", bindingCount)
		}
		if consumerCount != 2 {
			t.Errorf("expected 2 consumers, got %d", consumerCount)
		}

		// The global DLX topology is declared once, in NewSubscriber.
		ch.mu.Lock()
		exchangeDeclareCount := len(ch.exchangeDeclares)
		ch.mu.Unlock()
		if exchangeDeclareCount != 1 {
			t.Errorf("expected 1 exchange declare (galaxify.dlx), got %d", exchangeDeclareCount)
		}

		// Every service queue must dead-letter into galaxify.dlx (ADR-0009).
		for _, queueName := range []string{"daily-service.user.created", "daily-service.daily.completed"} {
			declared, ok := queueDeclareByName(ch, queueName)
			if !ok {
				t.Fatalf("expected queue %s to be declared", queueName)
			}
			if got := declared.args[deadLetterArgName]; got != dlxExchangeName {
				t.Errorf("queue %s %s = %v, want %q", queueName, deadLetterArgName, got, dlxExchangeName)
			}
			if !declared.durable {
				t.Errorf("expected queue %s to stay durable", queueName)
			}
			if declared.autoDelete || declared.exclusive || declared.noWait {
				t.Errorf("queue %s autoDelete/exclusive/noWait = %v/%v/%v, want all false", queueName, declared.autoDelete, declared.exclusive, declared.noWait)
			}
			if _, ok := queueBindByNames(ch, queueName, eventsExchangeName); !ok {
				t.Errorf("expected queue %s to stay bound to %s", queueName, eventsExchangeName)
			}
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

	t.Run("returns error when service queue declare fails", func(t *testing.T) {
		wantErr := errors.New("service queue declare failed")
		ch := newFakeSubscriberChannel()
		s, err := NewSubscriber(ch, "daily-service")
		if err != nil {
			t.Fatalf("NewSubscriber returned error: %v", err)
		}
		// Injected after construction: the dead-letter topology is declared in
		// NewSubscriber, so this error can only come from the service queue.
		ch.declareErr = wantErr
		s.On("user.created", func(ctx context.Context, eventType string, payload []byte) error { return nil })

		if err := s.Start(context.Background()); !errors.Is(err, wantErr) {
			t.Fatalf("expected queue declare error %v, got %v", wantErr, err)
		}
	})

	t.Run("returns error when service queue bind fails", func(t *testing.T) {
		wantErr := errors.New("service queue bind failed")
		ch := newFakeSubscriberChannel()
		s, err := NewSubscriber(ch, "daily-service")
		if err != nil {
			t.Fatalf("NewSubscriber returned error: %v", err)
		}
		ch.bindErr = wantErr
		s.On("user.created", func(ctx context.Context, eventType string, payload []byte) error { return nil })

		if err := s.Start(context.Background()); !errors.Is(err, wantErr) {
			t.Fatalf("expected queue bind error %v, got %v", wantErr, err)
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

	t.Run("nacks without requeue on handler error so the message dead-letters", func(t *testing.T) {
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
		if rec.requeue {
			t.Error("expected nack with requeue=false so the message is routed to galaxify.dlx instead of being redelivered forever")
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
			gotRequestID = sharedhttp.RequestIDFromContext(ctx)
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
