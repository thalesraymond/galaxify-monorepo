package publisher_test

import (
	"context"
	"testing"

	"github.com/thalesraymond/galaxify-monorepo/apps/ship-service/internal/publisher"
)

func TestNoOpPublisher(t *testing.T) {
	var pub publisher.EventPublisher = publisher.NewNoOpPublisher()
	if pub == nil {
		t.Fatal("expected NewNoOpPublisher to return non-nil")
	}

	ctx := context.Background()
	err := pub.Publish(ctx, "test.event", map[string]string{"hello": "world"})
	if err != nil {
		t.Fatalf("expected nil error from NoOpPublisher.Publish, got %v", err)
	}
}
