package database

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

type recordedDatabaseCall struct {
	statement string
	arguments []any
}

type recordingDBTX struct {
	calls []recordedDatabaseCall
	row   pgx.Row
	rows  pgx.Rows
}

// emptyRows embeds the pgx.Rows interface so a :many query can run to
// completion with no results without a live database.
type emptyRows struct {
	pgx.Rows
}

func (emptyRows) Close()            {}
func (emptyRows) Err() error        { return nil }
func (emptyRows) Next() bool        { return false }
func (emptyRows) Scan(...any) error { return nil }

func (db *recordingDBTX) Exec(_ context.Context, statement string, arguments ...any) (pgconn.CommandTag, error) {
	db.calls = append(db.calls, recordedDatabaseCall{statement: statement, arguments: arguments})
	return pgconn.NewCommandTag("DELETE 1"), nil
}

func (db *recordingDBTX) Query(_ context.Context, statement string, arguments ...any) (pgx.Rows, error) {
	db.calls = append(db.calls, recordedDatabaseCall{statement: statement, arguments: arguments})
	return db.rows, nil
}

func (db *recordingDBTX) QueryRow(_ context.Context, statement string, arguments ...any) pgx.Row {
	db.calls = append(db.calls, recordedDatabaseCall{statement: statement, arguments: arguments})
	return db.row
}

type dailyRow struct {
	daily Daily
}

func (r dailyRow) Scan(destinations ...any) error {
	values := []any{
		r.daily.ID,
		r.daily.UserID,
		r.daily.Title,
		r.daily.Description,
		r.daily.Difficulty,
		r.daily.DueDate,
		r.daily.Status,
		r.daily.CreatedAt,
		r.daily.UpdatedAt,
		r.daily.TimeZone,
	}
	for i, destination := range destinations {
		reflect.ValueOf(destination).Elem().Set(reflect.ValueOf(values[i]))
	}
	return nil
}

// TestCompletedDailyMutationQueryContract is the query-seam regression test
// that distinguishes the former conflict path. Before completed recurrent
// Dailies became mutable, UpdateDaily and DeleteDaily carried
// `AND status = 'PENDING'`, so a COMPLETED row matched zero rows and the
// domain surfaced ErrDailyNotPending (mapped to the now-retired 409
// DAILY_NOT_EDITABLE). These generated statements must stay status-agnostic,
// which is what makes a COMPLETED Daily editable and deletable while the
// separate daily_history table remains untouched.
func TestCompletedDailyMutationQueryContract(t *testing.T) {
	userID := uuid.New()
	dailyID := uuid.New()
	now := time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)
	completed := Daily{
		ID:          pgtype.UUID{Bytes: dailyID, Valid: true},
		UserID:      pgtype.UUID{Bytes: userID, Valid: true},
		Title:       "Calibrate sensors",
		Description: "before launch",
		Difficulty:  "MEDIUM",
		DueDate:     pgtype.Timestamptz{Time: now, Valid: true},
		Status:      "COMPLETED",
		CreatedAt:   pgtype.Timestamptz{Time: now, Valid: true},
		UpdatedAt:   pgtype.Timestamptz{Time: now, Valid: true},
		TimeZone:    "America/New_York",
	}
	db := &recordingDBTX{row: dailyRow{daily: completed}}
	queries := New(db)

	updated, err := queries.UpdateDaily(context.Background(), UpdateDailyParams{
		ID:     completed.ID,
		UserID: completed.UserID,
		Title:  pgtype.Text{String: "Recalibrate sensors", Valid: true},
	})
	if err != nil {
		t.Fatalf("UpdateDaily() error = %v", err)
	}
	if updated.Status != "COMPLETED" {
		t.Errorf("updated status = %q, want COMPLETED", updated.Status)
	}
	if updated.TimeZone != "America/New_York" {
		t.Errorf("updated time zone = %q, want America/New_York", updated.TimeZone)
	}

	if _, err := queries.DeleteDaily(context.Background(), DeleteDailyParams{
		ID:     completed.ID,
		UserID: completed.UserID,
	}); err != nil {
		t.Fatalf("DeleteDaily() error = %v", err)
	}

	if len(db.calls) != 2 {
		t.Fatalf("database calls = %d, want 2", len(db.calls))
	}
	for _, call := range db.calls {
		assertCompletedDailyMutationStatement(t, call.statement)
		if strings.Contains(call.statement, "daily_history") {
			t.Errorf("statement unexpectedly touches daily_history: %s", call.statement)
		}
	}
}

func assertCompletedDailyMutationStatement(t *testing.T, statement string) {
	t.Helper()
	whereStart := strings.Index(statement, "WHERE")
	if whereStart == -1 {
		t.Fatalf("statement has no WHERE clause: %q", statement)
	}
	whereClause := strings.SplitN(statement[whereStart:], "RETURNING", 2)[0]
	if !strings.Contains(whereClause, "id = $1 AND user_id = $2") {
		t.Errorf("statement ownership predicate = %q, want id and user_id", whereClause)
	}
	if strings.Contains(whereClause, "status") {
		t.Errorf("statement must not restrict completed dailies by status (former pending-only conflict path): %q", whereClause)
	}
}

// TestDailyHistoryPaginationQueryContract is the query-seam regression test for
// stable descending continuation. It pins the generated statement to a keyset
// predicate over the unique (due_date, archived_at, id) tuple, the matching
// ORDER BY, an ownership filter, and a bounded LIMIT — the properties that make
// traversal duplicate-free and immune to inserts between pages.
func TestDailyHistoryPaginationQueryContract(t *testing.T) {
	userID := uuid.New()
	cursorID := uuid.New()
	dueDate := time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC)
	archivedAt := time.Date(2026, 9, 15, 11, 0, 0, 0, time.UTC)

	db := &recordingDBTX{rows: emptyRows{}}
	queries := New(db)

	if _, err := queries.ListDailyHistory(context.Background(), ListDailyHistoryParams{
		UserID:           pgtype.UUID{Bytes: userID, Valid: true},
		CursorDueDate:    pgtype.Timestamptz{Time: dueDate, Valid: true},
		CursorArchivedAt: pgtype.Timestamptz{Time: archivedAt, Valid: true},
		CursorID:         pgtype.UUID{Bytes: cursorID, Valid: true},
		PageSize:         21,
	}); err != nil {
		t.Fatalf("ListDailyHistory() error = %v", err)
	}

	if len(db.calls) != 1 {
		t.Fatalf("database calls = %d, want 1", len(db.calls))
	}
	call := db.calls[0]
	assertDailyHistoryPaginationStatement(t, call.statement)

	if len(call.arguments) != 5 {
		t.Fatalf("arguments = %d, want 5", len(call.arguments))
	}
	if got, ok := call.arguments[0].(pgtype.UUID); !ok || got.Bytes != userID {
		t.Errorf("argument 1 = %#v, want user id %v", call.arguments[0], userID)
	}
	if got, ok := call.arguments[1].(pgtype.Timestamptz); !ok || !got.Time.Equal(dueDate) {
		t.Errorf("argument 2 = %#v, want cursor due date %v", call.arguments[1], dueDate)
	}
	if got, ok := call.arguments[2].(pgtype.Timestamptz); !ok || !got.Time.Equal(archivedAt) {
		t.Errorf("argument 3 = %#v, want cursor archived at %v", call.arguments[2], archivedAt)
	}
	if got, ok := call.arguments[3].(pgtype.UUID); !ok || got.Bytes != cursorID {
		t.Errorf("argument 4 = %#v, want cursor id %v", call.arguments[3], cursorID)
	}
	if got, ok := call.arguments[4].(int32); !ok || got != 21 {
		t.Errorf("argument 5 = %#v, want page size 21", call.arguments[4])
	}
}

func assertDailyHistoryPaginationStatement(t *testing.T, statement string) {
	t.Helper()
	if !strings.Contains(statement, "user_id = $1") {
		t.Errorf("statement is missing the ownership predicate: %q", statement)
	}
	if !strings.Contains(statement, "(due_date, archived_at, id) <") {
		t.Errorf("statement is missing the keyset tuple predicate: %q", statement)
	}
	if !strings.Contains(statement, "ORDER BY due_date DESC, archived_at DESC, id DESC") {
		t.Errorf("statement is missing the deterministic descending order including the id tie-breaker: %q", statement)
	}
	if !strings.Contains(statement, "LIMIT $5::int") {
		t.Errorf("statement is missing the bounded page limit: %q", statement)
	}
}
