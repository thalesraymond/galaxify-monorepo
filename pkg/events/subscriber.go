package events

import (
	"context"
	"fmt"
	"log/slog"
	"maps"
	"sync"

	"github.com/rabbitmq/amqp091-go"
	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

type HandlerFunc func(ctx context.Context, eventType string, payload []byte) error

// SubscriberChannel is the subset of amqp091.Channel the Subscriber needs.
// *amqp091.Channel satisfies it directly; tests can substitute a fake.
type SubscriberChannel interface {
	QueueDeclare(name string, durable, autoDelete, exclusive, noWait bool, args amqp091.Table) (amqp091.Queue, error)
	QueueBind(name, key, exchange string, noWait bool, args amqp091.Table) error
	Consume(queue, consumer string, autoAck, exclusive, noLocal, noWait bool, args amqp091.Table) (<-chan amqp091.Delivery, error)
	Cancel(consumer string, noWait bool) error
	Close() error
}

// Compile-time assertion that *amqp091.Channel satisfies SubscriberChannel.
var _ SubscriberChannel = (*amqp091.Channel)(nil)

type Subscriber struct {
	serviceName string
	channel     SubscriberChannel
	handlers    map[string]HandlerFunc
	logger      *slog.Logger

	mu sync.RWMutex
	wg sync.WaitGroup
}

func NewSubscriber(channel SubscriberChannel, serviceName string, opts ...Option) (*Subscriber, error) {
	o := applyOptions(opts)
	return &Subscriber{
		serviceName: serviceName,
		channel:     channel,
		handlers:    make(map[string]HandlerFunc),
		logger:      o.logger,
	}, nil
}

func (s *Subscriber) On(eventType string, handler HandlerFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.handlers[eventType] = handler
}

func (s *Subscriber) Start(ctx context.Context) error {
	s.mu.RLock()
	handlers := make(map[string]HandlerFunc, len(s.handlers))
	maps.Copy(handlers, s.handlers)
	s.mu.RUnlock()

	if len(handlers) == 0 {
		s.logger.Info("No handlers registered, subscriber will not start")
		return nil
	}

	for key := range handlers {
		queue, err := s.setupBrokerQueue(key)
		if err != nil {
			return err
		}

		msgs, err := s.channel.Consume(
			queue.Name, // queue
			"",         // consumer
			false,      // auto-ack
			false,      // exclusive
			false,      // no-local
			false,      // no-wait
			nil,        // args
		)

		if err != nil {
			return fmt.Errorf("failed to consume messages: %w", err)
		}

		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			for msg := range msgs {
				handlerCtx := ctx

				if msg.Headers != nil {
					if requestID, ok := msg.Headers["X-Request-ID"].(string); ok {
						handlerCtx = sharedhttp.WithRequestID(handlerCtx, requestID)
					}
				}

				s.mu.RLock()
				handler, ok := handlers[msg.RoutingKey]
				s.mu.RUnlock()

				if !ok {
					s.logger.Warn("No handler registered for event type",
						"event_type", msg.RoutingKey,
					)
					nackErr := msg.Nack(false, true)
					if nackErr != nil {
						s.logger.Error("Failed to nack message",
							"event_type", msg.RoutingKey,
							"error", nackErr,
						)
					}
					continue
				}
				handlerErr := handler(handlerCtx, msg.RoutingKey, msg.Body)

				if handlerErr != nil {
					s.logger.Error("Handler error",
						"event_type", msg.RoutingKey,
						"error", handlerErr,
					)
					_ = msg.Nack(false, true)

				} else {
					_ = msg.Ack(false)
				}
			}
		}()

	}

	return nil
}

func (s *Subscriber) setupBrokerQueue(eventType string) (amqp091.Queue, error) {
	queueName := fmt.Sprintf("%s.%s", s.serviceName, eventType)

	queue, err := s.channel.QueueDeclare(
		queueName, // name
		true,      // durable
		false,     // delete when unused
		false,     // exclusive
		false,     // no-wait
		nil,       // arguments
	)

	if err != nil {
		return amqp091.Queue{}, fmt.Errorf("failed to declare queue: %w", err)
	}

	err = s.channel.QueueBind(
		queueName,         // queue name
		eventType,         // routing key
		"galaxify.events", // exchange
		false,             // no-wait
		nil,               // arguments
	)

	if err != nil {
		return amqp091.Queue{}, fmt.Errorf("failed to bind queue: %w", err)
	}
	return queue, nil
}

func (s *Subscriber) Shutdown(ctx context.Context) error {
	err := s.channel.Cancel("", false)
	if err != nil {
		return fmt.Errorf("failed to cancel consumer: %w", err)
	}

	// Wait for in-flight handlers to finish, or for ctx to expire.
	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-ctx.Done():
		return fmt.Errorf("timed out waiting for in-flight handlers: %w", ctx.Err())
	}

	err = s.channel.Close()
	if err != nil {
		return fmt.Errorf("failed to close channel: %w", err)
	}

	return nil

}
