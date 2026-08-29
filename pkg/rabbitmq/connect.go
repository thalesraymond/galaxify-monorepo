// Package rabbitmq provides the shared RabbitMQ client wrapper used by
// Galaxify services to publish and consume messages.
package rabbitmq

import (
	"fmt"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

// Connect dials the RabbitMQ broker at url and verifies the connection is
// usable by opening and closing a throwaway channel (which exercises the AMQP
// handshake end to end). The caller owns the returned connection and must
// Close it when done.
func Connect(url string) (*amqp.Connection, error) {
	conn, err := amqp.DialConfig(url, amqp.Config{
		Heartbeat: 10 * time.Second,
	})
	if err != nil {
		return nil, fmt.Errorf("dial rabbitmq: %w", err)
	}

	ch, err := conn.Channel()
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("verify rabbitmq connection: open channel: %w", err)
	}
	if err := ch.Close(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("verify rabbitmq connection: close channel: %w", err)
	}

	return conn, nil
}
