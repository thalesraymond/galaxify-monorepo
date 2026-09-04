package handler

import (
	"net/http"

	"github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/database"
	"github.com/thalesraymond/galaxify-monorepo/pkg/events"
)

const serviceName = "user-service"

type HandlerRegister struct {
	mux       *http.ServeMux
	querier   database.Querier
	publisher *events.Publisher
}

func NewHandlerRegister(mux *http.ServeMux, querier database.Querier, publisher *events.Publisher) *HandlerRegister {
	return &HandlerRegister{
		mux:       mux,
		querier:   querier,
		publisher: publisher,
	}
}

func (r *HandlerRegister) RegisterAllHandlers() {
	// Register health check routes
	healthHandler := NewHealthHandler(serviceName)
	healthHandler.RegisterHealthRoutes(r.mux)

	// Register user routes
	// userHandler := NewUserHandler(pool, publisher)
	// userHandler.RegisterUserRoutes(mux)
}
