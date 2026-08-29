# Context — Galaxify

Galaxify is the final project of the Boot.dev backend track: a space-themed
daily-task tracker ("mini Habitica"). It is built as a Go workspace monorepo
(`go.work`) of event-driven microservices, each with its own isolated
PostgreSQL database, communicating through a RabbitMQ message bus.

Repo layout, architecture decisions, and their rationale are recorded in
`docs/adr/`. Status and roadmap live in the repository README.

> This file is intentionally minimal: domain vocabulary and glossary entries
> are added lazily as terminology gets settled during implementation.