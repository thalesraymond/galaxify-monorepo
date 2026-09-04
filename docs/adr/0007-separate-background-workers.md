# 7. Separate Background Workers from Stateless APIs

Date: 2026-09-02

## Status

Accepted

## Context

Galaxify relies on background tasks such as the daily missed-task cron worker (which sweeps expired dailies) and potentially future outbox drainers. Previously, the plan was to run these within the stateless API containers (e.g. `apps/daily-service`). However, API containers are designed to be stateless and scaled dynamically—potentially scaling to zero when there is no incoming HTTP traffic. 

If background workers and cron jobs run inside these auto-scaling API containers, they might not run at all if the container scales to zero, or they might double-fire and cause lock contention if multiple containers boot up rapidly.

## Decision

We will extract background workers and cron jobs into their own dedicated directory, `/workers/`. These will be built as separate, deployable units (suitable for serverless Lambdas, Azure Functions, or dedicated always-on worker containers) independent from the HTTP APIs in `/apps/`.

The repository structure is now:
- `/apps/`: Stateless HTTP API services.
- `/pkg/`: Shared Go libraries.
- `/workers/`: Background workers, cron jobs, and async task processors. *(Note: pending implementation in the codebase)*

## Consequences

- **Pros**: 
  - API containers can safely scale to zero without breaking background tasks.
  - Workers can be deployed and scaled independently as serverless functions (Lambdas/Functions).
  - Clear separation of concerns between handling HTTP requests and processing background workloads.
- **Cons**: 
  - Slightly more overhead in managing separate Go modules and deployments for workers.
