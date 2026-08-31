package events

import (
	"context"
	"fmt"
	"log"
	"maps"
	"sync"

	"github.com/rabbitmq/amqp091-go"
)

type HandlerFunc func(ctx context.Context, eventType string, payload []byte) error

type Subscriber struct {
	serviceName string
	channel     *amqp091.Channel
	handlers    map[string]HandlerFunc

	mu sync.RWMutex
}

func NewSubscriber(conn *amqp091.Connection, serviceName string) (*Subscriber, error) {
	ch, err := conn.Channel()
	if err != nil {
		return nil, err
	}

	return &Subscriber{serviceName: serviceName, channel: ch, handlers: make(map[string]HandlerFunc)}, nil
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
		log.Default().Printf("No handlers registered, subscriber will not start")
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

		go func() {
			for msg := range msgs {
				handlerCtx := ctx

				if msg.Headers != nil {
					if requestID, ok := msg.Headers["X-Request-ID"].(string); ok {
						handlerCtx = WithRequestID(handlerCtx, requestID)
					}
				}

				s.mu.RLock()
				handler, ok := handlers[msg.RoutingKey]
				s.mu.RUnlock()

				if !ok {
					log.Default().Printf("No handler registered for event type: %s", msg.RoutingKey)
					err = msg.Nack(false, true)
					if err != nil {
						log.Default().Printf("Failed to nack message: %v", err)
					}
					continue
				}
				err = handler(handlerCtx, msg.RoutingKey, msg.Body)

				if err != nil {
					log.Default().Printf("Handler error: %v", err)
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

	err = s.channel.Close()
	if err != nil {
		return fmt.Errorf("failed to close channel: %w", err)
	}

	return nil

}
