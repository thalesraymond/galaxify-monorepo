package events

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

// fakeProcessedEventStore is a stand-in for a service's sqlc *Queries type.
type fakeProcessedEventStore struct {
	inserted []pgtype.UUID
	rows     int64
	err      error
	purged   bool
}

func (f *fakeProcessedEventStore) InsertProcessedEvent(_ context.Context, eventID pgtype.UUID) (int64, error) {
	f.inserted = append(f.inserted, eventID)
	return f.rows, f.err
}

func (f *fakeProcessedEventStore) DeleteOldProcessedEvents(_ context.Context) (int64, error) {
	f.purged = true
	return f.rows, f.err
}

func TestMarkProcessedFirstTime(t *testing.T) {
	store := &fakeProcessedEventStore{rows: 1}
	pe := NewProcessedEvents(store)

	first, err := pe.MarkProcessed(context.Background(), "6f9619ff-8b86-d011-b42d-00cf4fc964ff")
	if err != nil {
		t.Fatalf("MarkProcessed returned error: %v", err)
	}
	if !first {
		t.Fatal("expected first-time processing to return true")
	}
	if len(store.inserted) != 1 {
		t.Fatalf("expected 1 insert, got %d", len(store.inserted))
	}
}

func TestMarkProcessedDuplicate(t *testing.T) {
	store := &fakeProcessedEventStore{rows: 0}
	pe := NewProcessedEvents(store)

	first, err := pe.MarkProcessed(context.Background(), "6f9619ff-8b86-d011-b42d-00cf4fc964ff")
	if err != nil {
		t.Fatalf("MarkProcessed returned error: %v", err)
	}
	if first {
		t.Fatal("expected duplicate event to return false")
	}
}

func TestMarkProcessedInvalidEventID(t *testing.T) {
	store := &fakeProcessedEventStore{}
	pe := NewProcessedEvents(store)

	if _, err := pe.MarkProcessed(context.Background(), "not-a-uuid"); err == nil {
		t.Fatal("expected error for invalid event_id, got nil")
	}
	if len(store.inserted) != 0 {
		t.Fatalf("expected no insert for invalid event_id, got %d", len(store.inserted))
	}
}

func TestMarkProcessedStoreError(t *testing.T) {
	wantErr := errors.New("db down")
	store := &fakeProcessedEventStore{err: wantErr}
	pe := NewProcessedEvents(store)

	if _, err := pe.MarkProcessed(context.Background(), "6f9619ff-8b86-d011-b42d-00cf4fc964ff"); !errors.Is(err, wantErr) {
		t.Fatalf("expected store error %v, got %v", wantErr, err)
	}
}

func TestPurgeOld(t *testing.T) {
	store := &fakeProcessedEventStore{rows: 42}
	pe := NewProcessedEvents(store)

	n, err := pe.PurgeOld(context.Background())
	if err != nil {
		t.Fatalf("PurgeOld returned error: %v", err)
	}
	if n != 42 {
		t.Fatalf("expected 42 rows purged, got %d", n)
	}
	if !store.purged {
		t.Fatal("expected DeleteOldProcessedEvents to be called")
	}
}
