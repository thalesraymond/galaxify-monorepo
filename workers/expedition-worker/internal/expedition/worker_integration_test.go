//go:build integration

package expedition

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

const serviceSchemaDir = "../../../../apps/expedition-service/sql/schema"

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

func countRows(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("count query %q: %v", sql, err)
	}
	return n
}

func seedExpedition(t *testing.T, pool *pgxpool.Pool, id, userID string, materials int, chance float64, resolveAt time.Time) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO expeditions (id, user_id, materials_invested, success_chance, resolve_at, status)
		 VALUES ($1, $2, $3, $4, $5, 'IN_FLIGHT')`,
		id, userID, materials, chance, resolveAt); err != nil {
		t.Fatalf("seed expedition: %v", err)
	}
}

func assertResolutionOutcome(t *testing.T, pool *pgxpool.Pool, expeditionID, userID, wantStatus, wantOutcome string, wantReward int, now time.Time) {
	t.Helper()

	var status string
	var resolvedAt *time.Time
	err := pool.QueryRow(context.Background(),
		"SELECT status, resolved_at FROM expeditions WHERE id = $1", expeditionID).
		Scan(&status, &resolvedAt)
	if err != nil {
		t.Fatalf("get expedition %s: %v", expeditionID, err)
	}
	if status != wantStatus {
		t.Fatalf("expedition status = %s, want %s", status, wantStatus)
	}
	if resolvedAt == nil || !resolvedAt.Equal(now) {
		t.Fatalf("resolved_at = %v, want %s", resolvedAt, now)
	}

	if n := countRows(t, pool, "SELECT COUNT(*) FROM expedition_results WHERE expedition_id = $1", expeditionID); n != 1 {
		t.Fatalf("expedition_results rows = %d, want 1", n)
	}
	var outcome string
	var reward int
	if err := pool.QueryRow(context.Background(),
		"SELECT outcome, materials_reward FROM expedition_results WHERE expedition_id = $1", expeditionID).
		Scan(&outcome, &reward); err != nil {
		t.Fatalf("read result: %v", err)
	}
	if outcome != wantOutcome || reward != wantReward {
		t.Fatalf("result = %s/%d, want %s/%d", outcome, reward, wantOutcome, wantReward)
	}

	if n := countRows(t, pool, "SELECT COUNT(*) FROM outbox"); n != 1 {
		t.Fatalf("outbox rows = %d, want 1", n)
	}
	var eventType, eventStatus string
	var payload []byte
	if err := pool.QueryRow(context.Background(),
		"SELECT event_type, status, payload FROM outbox").Scan(&eventType, &eventStatus, &payload); err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	if eventType != EventTypeCompleted || eventStatus != "PENDING" {
		t.Fatalf("outbox = %s/%s, want %s/PENDING", eventType, eventStatus, EventTypeCompleted)
	}
	var evt events.ExpeditionCompleted
	if err := json.Unmarshal(payload, &evt); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	want := events.ExpeditionCompleted{
		Version:         1,
		UserID:          userID,
		ExpeditionID:    expeditionID,
		Outcome:         wantOutcome,
		MaterialsReward: wantReward,
	}
	if evt != want {
		t.Fatalf("event = %+v, want %+v", evt, want)
	}
}

func TestWorkerTickConcurrentReplicaSafety(t *testing.T) {
	const (
		userID       = "11111111-1111-1111-1111-111111111111"
		expeditionID = "22222222-2222-2222-2222-222222222222"
	)
	resolveAt := time.Date(2026, 9, 5, 11, 0, 0, 0, time.UTC)
	now := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name        string
		roll        float64
		wantStatus  string
		wantOutcome string
		wantReward  int
	}{
		{name: "success", roll: 0.25, wantStatus: StatusResolved, wantOutcome: OutcomeSuccess, wantReward: 175},
		{name: "failure", roll: 0.75, wantStatus: StatusFailed, wantOutcome: OutcomeFailure, wantReward: 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pool := pgtest.New(t, serviceSchemaDir)
			seedExpedition(t, pool, expeditionID, userID, 100, 0.5, resolveAt)
			gate := pgtest.NewCommitGate(pool, 1)

			worker1 := NewResolutionWorker(NewPgStore(gate), noopDrainer{},
				WithLogger(newSilentLogger()),
				WithClock(func() time.Time { return now }),
				WithRoller(func() float64 { return tc.roll }))

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
			worker2 := NewResolutionWorker(NewPgStore(pool2), noopDrainer{},
				WithLogger(newSilentLogger()),
				WithClock(func() time.Time { return now }),
				WithRoller(func() float64 { return tc.roll }))
			ctx2, cancel2 := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel2()
			if err := worker2.Tick(ctx2); err != nil {
				t.Fatalf("replica tick while lock held: %v", err)
			}

			gate.Release()
			if err := <-w1Done; err != nil {
				t.Fatalf("worker1 tick: %v", err)
			}

			assertResolutionOutcome(t, pool, expeditionID, userID, tc.wantStatus, tc.wantOutcome, tc.wantReward, now)

			mustTick(t, NewResolutionWorker(NewPgStore(pool), noopDrainer{},
				WithLogger(newSilentLogger()),
				WithClock(func() time.Time { return now }),
				WithRoller(func() float64 { return tc.roll })))
			mustTick(t, NewResolutionWorker(NewPgStore(pool2), noopDrainer{},
				WithLogger(newSilentLogger()),
				WithClock(func() time.Time { return now }),
				WithRoller(func() float64 { return tc.roll })))
			assertResolutionOutcome(t, pool, expeditionID, userID, tc.wantStatus, tc.wantOutcome, tc.wantReward, now)
		})
	}
}

func TestWorkerTickCommitFailureRollsBack(t *testing.T) {
	const (
		userID       = "33333333-3333-3333-3333-333333333333"
		expeditionID = "44444444-4444-4444-4444-444444444444"
	)
	resolveAt := time.Date(2026, 9, 5, 11, 0, 0, 0, time.UTC)
	now := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)

	pool := pgtest.New(t, serviceSchemaDir)
	seedExpedition(t, pool, expeditionID, userID, 100, 0.5, resolveAt)

	errCommitInjected := errors.New("injected commit failure")
	worker := NewResolutionWorker(NewPgStore(pgtest.NewCommitFailure(pool, errCommitInjected)), noopDrainer{},
		WithLogger(newSilentLogger()),
		WithClock(func() time.Time { return now }),
		WithRoller(func() float64 { return 0.25 }))

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	err := worker.Tick(ctx)
	if !errors.Is(err, errCommitInjected) {
		t.Fatalf("tick error = %v, want errors.Is errCommitInjected", err)
	}

	var status string
	var resolvedAt *time.Time
	if err := pool.QueryRow(context.Background(),
		"SELECT status, resolved_at FROM expeditions WHERE id = $1", expeditionID).
		Scan(&status, &resolvedAt); err != nil {
		t.Fatalf("get expedition: %v", err)
	}
	if status != StatusInFlight || resolvedAt != nil {
		t.Fatalf("expedition changed despite commit failure: status=%s resolved_at=%v", status, resolvedAt)
	}
	if n := countRows(t, pool, "SELECT COUNT(*) FROM expedition_results"); n != 0 {
		t.Fatalf("expedition_results rows = %d, want 0 after rollback", n)
	}
	if n := countRows(t, pool, "SELECT COUNT(*) FROM outbox"); n != 0 {
		t.Fatalf("outbox rows = %d, want 0 after rollback", n)
	}

	retry := NewResolutionWorker(NewPgStore(pool), noopDrainer{},
		WithLogger(newSilentLogger()),
		WithClock(func() time.Time { return now }),
		WithRoller(func() float64 { return 0.25 }))
	mustTick(t, retry)
	mustTick(t, retry)
	assertResolutionOutcome(t, pool, expeditionID, userID, StatusResolved, OutcomeSuccess, 175, now)
}
