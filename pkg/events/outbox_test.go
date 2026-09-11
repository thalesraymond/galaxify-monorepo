package events

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/thalesraymond/galaxify-monorepo/pkg/sharedhttp"
)

type outboxBatchMock struct {
	records   []OutboxRecord
	marked    []int64
	committed bool
}

func (m *outboxBatchMock) ListPending(context.Context, int32) ([]OutboxRecord, error) {
	return m.records, nil
}

func (m *outboxBatchMock) MarkPublished(_ context.Context, id int64) error {
	m.marked = append(m.marked, id)
	return nil
}

func (m *outboxBatchMock) Commit(context.Context) error {
	m.committed = true
	return nil
}

func (m *outboxBatchMock) Rollback(context.Context) error { return nil }

type outboxPublisherMock struct {
	err        error
	eventType  string
	payload    any
	requestID  string
	occurredAt time.Time
}

func (m *outboxPublisherMock) Publish(ctx context.Context, eventType string, payload any, opts ...PublishOption) error {
	m.eventType = eventType
	m.payload = payload
	m.requestID = sharedhttp.RequestIDFromContext(ctx)
	m.occurredAt = applyPublishOptions(opts).occurredAt
	return m.err
}

func TestOutboxDrainerDrain(t *testing.T) {
	tests := []struct {
		name       string
		publishErr error
		wantMarked bool
	}{
		{name: "publishes and marks pending event", wantMarked: true},
		{name: "leaves event pending when publish fails", publishErr: errors.New("broker unavailable")},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			batch := &outboxBatchMock{records: []OutboxRecord{{
				ID: 7, EventID: "7e850eae-c44e-45f8-9392-492e7b6b3c10",
				EventType: "expedition.launched", Payload: []byte(`{"version":1}`), RequestID: "launch-request",
				OccurredAt: time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC),
			}}}
			publisher := &outboxPublisherMock{err: test.publishErr}
			drainer := NewOutboxDrainer(
				func(context.Context) (OutboxBatch, error) { return batch, nil },
				publisher,
				slog.New(slog.NewTextHandler(io.Discard, nil)),
			)

			drainer.Drain(t.Context(), 50)

			if !batch.committed {
				t.Error("transaction was not committed")
			}
			if got := len(batch.marked) == 1; got != test.wantMarked {
				t.Errorf("marked = %v, want marked %t", batch.marked, test.wantMarked)
			}
			if publisher.eventType != "expedition.launched" {
				t.Errorf("event type = %q, want expedition.launched", publisher.eventType)
			}
			if publisher.requestID != "launch-request" {
				t.Errorf("request ID = %q, want launch-request", publisher.requestID)
			}
			wantOccurredAt := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
			if !publisher.occurredAt.Equal(wantOccurredAt) {
				t.Errorf("occurred_at = %s, want %s", publisher.occurredAt, wantOccurredAt)
			}
		})
	}
}

func TestOutboxDrainerDrainAfterRequest(t *testing.T) {
	drainStarted := make(chan struct{}, 1)
	batch := &outboxBatchMock{}
	drainer := NewOutboxDrainer(func(context.Context) (OutboxBatch, error) {
		drainStarted <- struct{}{}
		return batch, nil
	}, &outboxPublisherMock{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	nextCalled := false
	handler := drainer.DrainAfterRequest(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	}), 50)

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/health", nil))

	if !nextCalled || recorder.Code != http.StatusNoContent {
		t.Fatalf("wrapped handler response = called %t, status %d", nextCalled, recorder.Code)
	}
	select {
	case <-drainStarted:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("drain was not triggered after request")
	}
}
