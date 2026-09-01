package events

import "log/slog"

// Option configures a Publisher or Subscriber.
type Option func(*options)

type options struct {
	logger *slog.Logger
}

// WithLogger sets the logger used by the Publisher or Subscriber.
// Defaults to slog.Default() when not provided.
func WithLogger(logger *slog.Logger) Option {
	return func(o *options) {
		o.logger = logger
	}
}

// applyOptions applies the given options over the defaults.
func applyOptions(opts []Option) options {
	o := options{logger: slog.Default()}
	for _, opt := range opts {
		opt(&o)
	}
	return o
}
