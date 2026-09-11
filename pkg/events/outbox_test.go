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

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

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

type fakeOutboxRow struct {
	ID        int64
	EventID   pgtype.UUID
	EventType string
	Payload   []byte
	CreatedAt time.Time
}

type fakeOutboxQueries struct {
	rows   []fakeOutboxRow
	limit  int32
	marked []int64
}

func (q *fakeOutboxQueries) ListPendingOutbox(_ context.Context, limit int32) ([]fakeOutboxRow, error) {
	q.limit = limit
	return q.rows, nil
}

func (q *fakeOutboxQueries) MarkOutboxPublished(_ context.Context, id int64) error {
	q.marked = append(q.marked, id)
	return nil
}

type fakeOutboxTx struct {
	pgx.Tx
	committed  bool
	rolledBack bool
}

func (tx *fakeOutboxTx) Commit(context.Context) error   { tx.committed = true; return nil }
func (tx *fakeOutboxTx) Rollback(context.Context) error { tx.rolledBack = true; return nil }

func TestNewOutboxBatch(t *testing.T) {
	eventID := uuid.MustParse("7e850eae-c44e-45f8-9392-492e7b6b3c10")
	createdAt := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	queries := &fakeOutboxQueries{rows: []fakeOutboxRow{{
		ID: 7, EventID: pgtype.UUID{Bytes: eventID, Valid: true},
		EventType: "daily.completed", Payload: []byte(`{"version":1}`), CreatedAt: createdAt,
	}}}
	tx := &fakeOutboxTx{}
	batch := NewOutboxBatch(tx, queries, func(row fakeOutboxRow) OutboxRecord {
		return NewOutboxRecord(row.ID, row.EventID, row.EventType, row.Payload, "req-1", row.CreatedAt)
	})

	records, err := batch.ListPending(t.Context(), 25)
	if err != nil {
		t.Fatalf("ListPending() error = %v", err)
	}
	if queries.limit != 25 {
		t.Errorf("limit = %d, want 25", queries.limit)
	}
	if len(records) != 1 {
		t.Fatalf("records = %d, want 1", len(records))
	}
	if records[0].ID != 7 || records[0].EventID != eventID.String() || records[0].EventType != "daily.completed" {
		t.Errorf("record = %+v", records[0])
	}
	if records[0].RequestID != "req-1" || !records[0].OccurredAt.Equal(createdAt) {
		t.Errorf("record metadata = %+v", records[0])
	}

	if err := batch.MarkPublished(t.Context(), 7); err != nil {
		t.Fatalf("MarkPublished() error = %v", err)
	}
	if len(queries.marked) != 1 || queries.marked[0] != 7 {
		t.Errorf("marked = %v, want [7]", queries.marked)
	}

	if err := batch.Commit(t.Context()); err != nil {
		t.Fatalf("Commit() error = %v", err)
	}
	if !tx.committed {
		t.Error("transaction was not committed")
	}
	if err := batch.Rollback(t.Context()); err != nil {
		t.Fatalf("Rollback() error = %v", err)
	}
	if !tx.rolledBack {
		t.Error("transaction was not rolled back")
	}
}

func TestNewOutboxRecordCopiesPayload(t *testing.T) {
	eventID := uuid.MustParse("7e850eae-c44e-45f8-9392-492e7b6b3c10")
	payload := []byte(`{"version":1}`)

	record := NewOutboxRecord(1, pgtype.UUID{Bytes: eventID, Valid: true}, "user.created", payload, "", time.Time{})
	payload[0] = 'X'

	if string(record.Payload) != `{"version":1}` {
		t.Errorf("payload = %q, want an independent copy", record.Payload)
	}
	if record.EventID != eventID.String() {
		t.Errorf("event id = %q, want %q", record.EventID, eventID.String())
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
