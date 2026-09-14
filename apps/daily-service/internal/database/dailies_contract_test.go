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
}

func (db *recordingDBTX) Exec(_ context.Context, statement string, arguments ...any) (pgconn.CommandTag, error) {
	db.calls = append(db.calls, recordedDatabaseCall{statement: statement, arguments: arguments})
	return pgconn.NewCommandTag("DELETE 1"), nil
}

func (db *recordingDBTX) Query(_ context.Context, statement string, arguments ...any) (pgx.Rows, error) {
	db.calls = append(db.calls, recordedDatabaseCall{statement: statement, arguments: arguments})
	return nil, nil
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
