//go:build integration

package pgtest

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const pgPort = "55432"

func New(t *testing.T, schemaDir string) *pgxpool.Pool {
	t.Helper()
	initdb, err := exec.LookPath("initdb")
	if err != nil {
		t.Fatalf("integration prerequisite missing: initdb not in PATH: %v", err)
	}
	pgCtl, err := exec.LookPath("pg_ctl")
	if err != nil {
		t.Fatalf("integration prerequisite missing: pg_ctl not in PATH: %v", err)
	}

	root := t.TempDir()
	dataDir := filepath.Join(root, "pgdata")
	sockDir := filepath.Join(root, "sock")
	if err := os.MkdirAll(sockDir, 0o700); err != nil {
		t.Fatalf("create socket dir: %v", err)
	}
	logFile := filepath.Join(root, "postgres.log")

	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, initdb, "-D", dataDir, "-U", "postgres", "--auth=trust", "--no-sync").CombinedOutput(); err != nil {
		t.Fatalf("initdb: %v\n%s", err, out)
	}

	t.Cleanup(func() {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer stopCancel()
		if out, err := exec.CommandContext(stopCtx, pgCtl, "-D", dataDir, "-m", "fast", "-w", "-t", "15", "stop").CombinedOutput(); err != nil {
			logDump, _ := os.ReadFile(logFile)
			t.Errorf("pg_ctl stop %s: %v\n%s\npostgres log:\n%s", dataDir, err, out, logDump)
		}
	})

	pgOpts := fmt.Sprintf("-k %s -p %s -c listen_addresses='' -c fsync=off", sockDir, pgPort)
	if out, err := exec.CommandContext(ctx, pgCtl, "-D", dataDir, "-l", logFile, "-o", pgOpts, "-w", "-t", "30", "start").CombinedOutput(); err != nil {
		logDump, _ := os.ReadFile(logFile)
		t.Fatalf("pg_ctl start: %v\n%s\npostgres log:\n%s", err, out, logDump)
	}
	t.Logf("postgres cluster at %s, socket %s, log %s", dataDir, sockDir, logFile)

	applyMigrations(t, connString(sockDir), schemaDir)
	return NewPool(t, connString(sockDir))
}

func connString(sockDir string) string {
	return fmt.Sprintf("host=%s port=%s user=postgres dbname=postgres sslmode=disable", sockDir, pgPort)
}

func NewPool(t *testing.T, connStr string) *pgxpool.Pool {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		t.Fatalf("connect to test postgres: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func applyMigrations(t *testing.T, connStr, schemaDir string) {
	t.Helper()
	cfg, err := pgx.ParseConfig(connStr)
	if err != nil {
		t.Fatalf("parse migration conn config: %v", err)
	}
	cfg.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("connect for migrations: %v", err)
	}
	defer conn.Close(context.Background())

	entries, err := os.ReadDir(schemaDir)
	if err != nil {
		t.Fatalf("read schema dir %s: %v", schemaDir, err)
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			files = append(files, e.Name())
		}
	}
	if len(files) == 0 {
		t.Fatalf("no migrations found in %s", schemaDir)
	}
	for _, name := range files {
		raw, err := os.ReadFile(filepath.Join(schemaDir, name))
		if err != nil {
			t.Fatalf("read migration %s: %v", name, err)
		}
		up := gooseUp(string(raw))
		if up == "" {
			t.Fatalf("migration %s has no +goose Up section", name)
		}
		if _, err := conn.Exec(ctx, up); err != nil {
			t.Fatalf("apply migration %s: %v", name, err)
		}
	}
}

func gooseUp(sql string) string {
	upIdx := strings.Index(sql, "-- +goose Up")
	if upIdx < 0 {
		return ""
	}
	body := sql[upIdx+len("-- +goose Up"):]
	if downIdx := strings.Index(body, "-- +goose Down"); downIdx >= 0 {
		body = body[:downIdx]
	}
	return strings.TrimSpace(body)
}

type CommitGate struct {
	pool      *pgxpool.Pool
	ordinal   int32
	counter   atomic.Int32
	reached   chan struct{}
	release   chan struct{}
	reachOnce sync.Once
	once      sync.Once
}

func NewCommitGate(pool *pgxpool.Pool, ordinal int32) *CommitGate {
	return &CommitGate{
		pool:    pool,
		ordinal: ordinal,
		reached: make(chan struct{}),
		release: make(chan struct{}),
	}
}

func (g *CommitGate) Reached() <-chan struct{} {
	return g.reached
}

func (g *CommitGate) Release() {
	g.once.Do(func() { close(g.release) })
}

func (g *CommitGate) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := g.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return &gatedTx{Tx: tx, ord: g.counter.Add(1), gate: g}, nil
}

type gatedTx struct {
	pgx.Tx
	ord  int32
	gate *CommitGate
}

func (t *gatedTx) Commit(ctx context.Context) error {
	if t.ord == t.gate.ordinal {
		t.gate.reachOnce.Do(func() { close(t.gate.reached) })
		select {
		case <-t.gate.release:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return t.Tx.Commit(ctx)
}

type CommitFailure struct {
	pool  *pgxpool.Pool
	err   error
	armed atomic.Bool
}

func NewCommitFailure(pool *pgxpool.Pool, err error) *CommitFailure {
	f := &CommitFailure{pool: pool, err: err}
	f.armed.Store(true)
	return f
}

func (f *CommitFailure) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := f.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return &failTx{Tx: tx, armed: &f.armed, err: f.err}, nil
}

type failTx struct {
	pgx.Tx
	armed *atomic.Bool
	err   error
}

func (t *failTx) Commit(ctx context.Context) error {
	if t.armed.CompareAndSwap(true, false) {
		return t.err
	}
	return t.Tx.Commit(ctx)
}
