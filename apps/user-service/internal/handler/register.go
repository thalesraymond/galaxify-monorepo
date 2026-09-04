package handler

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
)

const serviceName = "user-service"

type HandlerRegister struct {
	Mux       *http.ServeMux
	pool      *pgxpool.Pool
	publisher *events.Publisher
}

func NewHandlerRegister(mux *http.ServeMux, pool *pgxpool.Pool, publisher *events.Publisher) *HandlerRegister {
	return &HandlerRegister{
		Mux:       mux,
		pool:      pool,
		publisher: publisher,
	}
}


func (r *HandlerRegister) RegisterAllHandlers() {
	// Register health check routes
	healthHandler := NewHealthHandler(serviceName)
	healthHandler.RegisterHealthRoutes(r.Mux)

	// Register user routes
	// userHandler := NewUserHandler(pool, publisher)
	// userHandler.RegisterUserRoutes(mux)
}
