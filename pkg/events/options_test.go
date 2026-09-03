package events

import (
	"log/slog"
	"os"
	"testing"
)

func TestApplyOptions(t *testing.T) {
	t.Run("default logger", func(t *testing.T) {
		opts := applyOptions(nil)
		if opts.logger == nil {
			t.Fatal("expected logger to not be nil")
		}
		if opts.logger != slog.Default() {
			t.Errorf("expected logger to be slog.Default(), got %v", opts.logger)
		}
	})

	t.Run("custom logger with WithLogger", func(t *testing.T) {
		customLogger := slog.New(slog.NewTextHandler(os.Stdout, nil))
		opts := applyOptions([]Option{WithLogger(customLogger)})

		if opts.logger == nil {
			t.Fatal("expected logger to not be nil")
		}
		if opts.logger != customLogger {
			t.Errorf("expected logger to be customLogger, got %v", opts.logger)
		}
	})
}
