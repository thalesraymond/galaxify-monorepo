//go:build integration

package cron

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
	"github.com/thalesraymond/galaxify-monorepo/pkg/pgtest"
)

const serviceSchemaDir = "../../../../apps/daily-service/sql/schema"

type noopDrainer struct{}

func (noopDrainer) Drain(context.Context, int32) {}

func mustTick(t *testing.T, w *Worker) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := w.Tick(ctx); err != nil {
		t.Fatalf("tick: %v", err)
	}
}

type dailyRow struct {
	Status   string
	DueDate  time.Time
	TimeZone string
}

func getDaily(t *testing.T, pool *pgxpool.Pool, id string) dailyRow {
	t.Helper()
	var r dailyRow
	err := pool.QueryRow(context.Background(),
		"SELECT status, due_date, time_zone FROM dailies WHERE id = $1", id).
		Scan(&r.Status, &r.DueDate, &r.TimeZone)
	if err != nil {
		t.Fatalf("get daily %s: %v", id, err)
	}
	return r
}

func countRows(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("count query %q: %v", sql, err)
	}
	return n
}

func seedDaily(t *testing.T, pool *pgxpool.Pool, id, userID, status, tz string, due time.Time) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, "INSERT INTO users_cache (id) VALUES ($1)", userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO dailies (id, user_id, title, description, difficulty, due_date, time_zone, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		id, userID, "integration daily", "seeded row", "EASY", due, tz, status); err != nil {
		t.Fatalf("seed daily: %v", err)
	}
}

func seedCompletedHistory(t *testing.T, pool *pgxpool.Pool, dailyID, userID, tz string, due time.Time) {
	t.Helper()
	completedAt := due.Add(-time.Hour)
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO daily_history (daily_id, user_id, title, description, difficulty, due_date, time_zone, status, completed_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED', $8)`,
		dailyID, userID, "integration daily", "seeded row", "EASY", due, tz, completedAt); err != nil {
		t.Fatalf("seed completed history: %v", err)
	}
}

type historyRow struct {
	Status      string
	UserID      string
	Title       string
	Description string
	Difficulty  string
	DueDate     time.Time
	TimeZone    string
	CompletedAt *time.Time
	MissedAt    *time.Time
}

func getHistory(t *testing.T, pool *pgxpool.Pool, dailyID string) []historyRow {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT status, user_id, title, description, difficulty, due_date, time_zone, completed_at, missed_at
		 FROM daily_history WHERE daily_id = $1 ORDER BY archived_at`, dailyID)
	if err != nil {
		t.Fatalf("read history: %v", err)
	}
	defer rows.Close()
	var out []historyRow
	for rows.Next() {
		var h historyRow
		if err := rows.Scan(&h.Status, &h.UserID, &h.Title, &h.Description, &h.Difficulty, &h.DueDate, &h.TimeZone, &h.CompletedAt, &h.MissedAt); err != nil {
			t.Fatalf("scan history: %v", err)
		}
		out = append(out, h)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate history: %v", err)
	}
	return out
}

func assertPendingMissOutcome(t *testing.T, pool *pgxpool.Pool, dailyID, userID, tz string, origDue, now, wantNextDue time.Time) {
	t.Helper()

	row := getDaily(t, pool, dailyID)
	if row.Status != "PENDING" {
		t.Fatalf("daily status = %s, want PENDING", row.Status)
	}
	if row.TimeZone != tz {
		t.Fatalf("daily time_zone = %s, want %s", row.TimeZone, tz)
	}
	if !row.DueDate.After(now) {
		t.Fatalf("daily due_date = %s, want strictly after now %s", row.DueDate, now)
	}
	if !row.DueDate.Equal(wantNextDue) {
		t.Fatalf("daily due_date = %s, want %s", row.DueDate, wantNextDue)
	}

	history := getHistory(t, pool, dailyID)
	if len(history) != 1 {
		t.Fatalf("daily_history rows = %d, want 1", len(history))
	}
	h := history[0]
	if h.Status != "MISSED" || h.UserID != userID || h.Title != "integration daily" ||
		h.Description != "seeded row" || h.Difficulty != "EASY" {
		t.Fatalf("unexpected history row: %+v", h)
	}
	if !h.DueDate.Equal(origDue) || h.TimeZone != tz {
		t.Fatalf("history archived due/tz = %s/%s, want %s/%s", h.DueDate, h.TimeZone, origDue, tz)
	}
	if h.CompletedAt != nil {
		t.Fatalf("history completed_at = %v, want null", h.CompletedAt)
	}
	if h.MissedAt == nil || !h.MissedAt.Equal(now) {
		t.Fatalf("history missed_at = %v, want %s", h.MissedAt, now)
	}

	assertMissedEvent(t, pool, dailyID, userID, 1)
}

func assertMissedEvent(t *testing.T, pool *pgxpool.Pool, dailyID, userID string, wantCount int) {
	t.Helper()
	if n := countRows(t, pool, "SELECT COUNT(*) FROM outbox"); n != wantCount {
		t.Fatalf("outbox rows = %d, want %d", n, wantCount)
	}
	if wantCount == 0 {
		return
	}
	var eventType, eventStatus string
	var payload []byte
	if err := pool.QueryRow(context.Background(),
		"SELECT event_type, status, payload FROM outbox").Scan(&eventType, &eventStatus, &payload); err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	if eventType != dailyMissedEventType || eventStatus != "PENDING" {
		t.Fatalf("outbox = %s/%s, want %s/PENDING", eventType, eventStatus, dailyMissedEventType)
	}
	var evt events.DailyMissed
	if err := json.Unmarshal(payload, &evt); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	want := events.DailyMissed{Version: 1, UserID: userID, DailyID: dailyID, DamageAmount: 5}
	if evt != want {
		t.Fatalf("event = %+v, want %+v", evt, want)
	}
}

func assertCompletedResetOutcome(t *testing.T, pool *pgxpool.Pool, dailyID, userID, tz string, origDue, now, wantNextDue time.Time) {
	t.Helper()

	row := getDaily(t, pool, dailyID)
	if row.Status != "PENDING" {
		t.Fatalf("daily status = %s, want PENDING", row.Status)
	}
	if row.TimeZone != tz {
		t.Fatalf("daily time_zone = %s, want %s", row.TimeZone, tz)
	}
	if !row.DueDate.After(now) {
		t.Fatalf("daily due_date = %s, want strictly after now %s", row.DueDate, now)
	}
	if !row.DueDate.Equal(wantNextDue) {
		t.Fatalf("daily due_date = %s, want %s", row.DueDate, wantNextDue)
	}

	history := getHistory(t, pool, dailyID)
	if len(history) != 1 {
		t.Fatalf("daily_history rows = %d, want 1 (prior completed only)", len(history))
	}
	h := history[0]
	if h.Status != "COMPLETED" || h.UserID != userID || h.Title != "integration daily" ||
		h.Description != "seeded row" || h.Difficulty != "EASY" {
		t.Fatalf("prior history row mutated: %+v", h)
	}
	if !h.DueDate.Equal(origDue) || h.TimeZone != tz {
		t.Fatalf("prior history due/tz = %s/%s, want %s/%s", h.DueDate, h.TimeZone, origDue, tz)
	}
	if h.CompletedAt == nil || !h.CompletedAt.Equal(origDue.Add(-time.Hour)) {
		t.Fatalf("prior history completed_at = %v, want %s", h.CompletedAt, origDue.Add(-time.Hour))
	}
	if h.MissedAt != nil {
		t.Fatalf("prior history missed_at = %v, want null", h.MissedAt)
	}
	if n := countRows(t, pool,
		"SELECT COUNT(*) FROM daily_history WHERE daily_id = $1 AND status = 'MISSED'", dailyID); n != 0 {
		t.Fatalf("MISSED history rows = %d, want 0", n)
	}
	assertMissedEvent(t, pool, dailyID, userID, 0)
}

func TestWorkerTickConcurrentReplicaSafety(t *testing.T) {
	const (
		userID  = "11111111-1111-1111-1111-111111111111"
		dailyID = "22222222-2222-2222-2222-222222222222"
	)
	due := time.Date(2026, 9, 5, 11, 0, 0, 0, time.UTC)
	now := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
	wantNextDue := time.Date(2026, 9, 6, 11, 0, 0, 0, time.UTC)

	t.Run("pending", func(t *testing.T) {
		pool := pgtest.New(t, serviceSchemaDir)
		seedDaily(t, pool, dailyID, userID, "PENDING", "UTC", due)
		gate := pgtest.NewCommitGate(pool, 1)

		worker1 := NewMissedDailyWorker(NewPgStore(gate), noopDrainer{},
			WithLogger(newSilentLogger()), WithClock(func() time.Time { return now }))

		w1ctx, w1cancel := context.WithTimeout(context.Background(), 30*time.Second)
		w1Done := make(chan error, 1)
		go func() {
			w1Done <- worker1.Tick(w1ctx)
			close(w1Done)
		}()
		t.Cleanup(func() {
			gate.Release()
			w1cancel()
			<-w1Done
		})

		select {
		case <-gate.Reached():
		case err := <-w1Done:
			t.Fatalf("worker1 exited before gated commit: %v", err)
		case <-time.After(15 * time.Second):
			t.Fatal("worker1 did not reach gated commit")
		}

		pool2 := pgtest.NewPool(t, pool.Config().ConnString())
		worker2 := NewMissedDailyWorker(NewPgStore(pool2), noopDrainer{},
			WithLogger(newSilentLogger()), WithClock(func() time.Time { return now }))
		ctx2, cancel2 := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel2()
		if err := worker2.Tick(ctx2); err != nil {
			t.Fatalf("replica tick while lock held: %v", err)
		}

		gate.Release()
		if err := <-w1Done; err != nil {
			t.Fatalf("worker1 tick: %v", err)
		}

		assertPendingMissOutcome(t, pool, dailyID, userID, "UTC", due, now, wantNextDue)

		mustTick(t, NewMissedDailyWorker(NewPgStore(pool), noopDrainer{},
			WithLogger(newSilentLogger()), WithClock(func() time.Time { return now })))
		mustTick(t, NewMissedDailyWorker(NewPgStore(pool2), noopDrainer{},
			WithLogger(newSilentLogger()), WithClock(func() time.Time { return now })))
		assertPendingMissOutcome(t, pool, dailyID, userID, "UTC", due, now, wantNextDue)
	})

	t.Run("completed", func(t *testing.T) {
		pool := pgtest.New(t, serviceSchemaDir)
		seedDaily(t, pool, dailyID, userID, "COMPLETED", "UTC", due)
		seedCompletedHistory(t, pool, dailyID, userID, "UTC", due)
		gate := pgtest.NewCommitGate(pool, 2)

		worker1 := NewMissedDailyWorker(NewPgStore(gate), noopDrainer{},
			WithLogger(newSilentLogger()), WithClock(func() time.Time { return now }))

		w1ctx, w1cancel := context.WithTimeout(context.Background(), 30*time.Second)
		w1Done := make(chan error, 1)
		go func() {
			w1Done <- worker1.Tick(w1ctx)
			close(w1Done)
		}()
		t.Cleanup(func() {
			gate.Release()
			w1cancel()
			<-w1Done
		})

		select {
		case <-gate.Reached():
		case err := <-w1Done:
			t.Fatalf("worker1 exited before gated commit: %v", err)
		case <-time.After(15 * time.Second):
			t.Fatal("worker1 did not reach gated commit")
		}

		pool2 := pgtest.NewPool(t, pool.Config().ConnString())
		worker2 := NewMissedDailyWorker(NewPgStore(pool2), noopDrainer{},
			WithLogger(newSilentLogger()), WithClock(func() time.Time { return now }))
		ctx2, cancel2 := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel2()
		if err := worker2.Tick(ctx2); err != nil {
			t.Fatalf("replica tick while lock held: %v", err)
		}

		gate.Release()
		if err := <-w1Done; err != nil {
			t.Fatalf("worker1 tick: %v", err)
		}

		assertCompletedResetOutcome(t, pool, dailyID, userID, "UTC", due, now, wantNextDue)

		mustTick(t, NewMissedDailyWorker(NewPgStore(pool), noopDrainer{},
			WithLogger(newSilentLogger()), WithClock(func() time.Time { return now })))
		mustTick(t, NewMissedDailyWorker(NewPgStore(pool2), noopDrainer{},
			WithLogger(newSilentLogger()), WithClock(func() time.Time { return now })))
		assertCompletedResetOutcome(t, pool, dailyID, userID, "UTC", due, now, wantNextDue)
	})
}

func TestWorkerTickCommitFailureRollsBack(t *testing.T) {
	const (
		userID  = "33333333-3333-3333-3333-333333333333"
		dailyID = "44444444-4444-4444-4444-444444444444"
	)
	due := time.Date(2026, 9, 5, 11, 0, 0, 0, time.UTC)
	now := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
	wantNextDue := time.Date(2026, 9, 6, 11, 0, 0, 0, time.UTC)

	pool := pgtest.New(t, serviceSchemaDir)
	seedDaily(t, pool, dailyID, userID, "PENDING", "UTC", due)

	errCommitInjected := errors.New("injected commit failure")
	worker := NewMissedDailyWorker(NewPgStore(pgtest.NewCommitFailure(pool, errCommitInjected)), noopDrainer{},
		WithLogger(newSilentLogger()), WithClock(func() time.Time { return now }))

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	err := worker.Tick(ctx)
	if !errors.Is(err, errCommitInjected) {
		t.Fatalf("tick error = %v, want errors.Is errCommitInjected", err)
	}

	row := getDaily(t, pool, dailyID)
	if row.Status != "PENDING" || !row.DueDate.Equal(due) {
		t.Fatalf("daily changed despite commit failure: status=%s due=%s", row.Status, row.DueDate)
	}
	if n := countRows(t, pool, "SELECT COUNT(*) FROM daily_history"); n != 0 {
		t.Fatalf("daily_history rows = %d, want 0 after rollback", n)
	}
	if n := countRows(t, pool, "SELECT COUNT(*) FROM outbox"); n != 0 {
		t.Fatalf("outbox rows = %d, want 0 after rollback", n)
	}

	retry := NewMissedDailyWorker(NewPgStore(pool), noopDrainer{},
		WithLogger(newSilentLogger()), WithClock(func() time.Time { return now }))
	mustTick(t, retry)
	mustTick(t, retry)
	assertPendingMissOutcome(t, pool, dailyID, userID, "UTC", due, now, wantNextDue)
}

func TestWorkerTickDueDateCalendar(t *testing.T) {
	const (
		userID  = "55555555-5555-5555-5555-555555555555"
		dailyID = "66666666-6666-6666-6666-666666666666"
	)
	cases := []struct {
		name     string
		timeZone string
		due      time.Time
		now      time.Time
		wantDue  time.Time
	}{
		{
			name:     "spring forward ordinary day",
			timeZone: "America/New_York",
			due:      time.Date(2026, 3, 7, 14, 30, 0, 0, time.UTC),
			now:      time.Date(2026, 3, 7, 15, 0, 0, 0, time.UTC),
			wantDue:  time.Date(2026, 3, 8, 13, 30, 0, 0, time.UTC),
		},
		{
			name:     "spring forward nonexistent wall time",
			timeZone: "America/New_York",
			due:      time.Date(2026, 3, 7, 7, 30, 0, 0, time.UTC),
			now:      time.Date(2026, 3, 7, 8, 0, 0, 0, time.UTC),
			wantDue:  time.Date(2026, 3, 8, 7, 0, 0, 0, time.UTC),
		},
		{
			name:     "fall back ambiguous wall time",
			timeZone: "America/New_York",
			due:      time.Date(2026, 10, 31, 5, 30, 0, 0, time.UTC),
			now:      time.Date(2026, 10, 31, 6, 0, 0, 0, time.UTC),
			wantDue:  time.Date(2026, 11, 1, 5, 30, 0, 0, time.UTC),
		},
		{
			name:     "multi day downtime utc",
			timeZone: "UTC",
			due:      time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC),
			now:      time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC),
			wantDue:  time.Date(2026, 11, 17, 9, 0, 0, 0, time.UTC),
		},
	}

	for _, status := range []string{"PENDING", "COMPLETED"} {
		for _, tc := range cases {
			t.Run(status+"/"+tc.name, func(t *testing.T) {
				pool := pgtest.New(t, serviceSchemaDir)
				seedDaily(t, pool, dailyID, userID, status, tc.timeZone, tc.due)
				if status == "COMPLETED" {
					seedCompletedHistory(t, pool, dailyID, userID, tc.timeZone, tc.due)
				}

				worker := NewMissedDailyWorker(NewPgStore(pool), noopDrainer{},
					WithLogger(newSilentLogger()), WithClock(func() time.Time { return tc.now }))
				mustTick(t, worker)

				assertOutcome := func() {
					if status == "PENDING" {
						assertPendingMissOutcome(t, pool, dailyID, userID, tc.timeZone, tc.due, tc.now, tc.wantDue)
					} else {
						assertCompletedResetOutcome(t, pool, dailyID, userID, tc.timeZone, tc.due, tc.now, tc.wantDue)
					}
				}
				assertOutcome()

				repeated := NewMissedDailyWorker(NewPgStore(pool), noopDrainer{},
					WithLogger(newSilentLogger()), WithClock(func() time.Time { return tc.now }))
				mustTick(t, repeated)
				assertOutcome()
			})
		}
	}
}
