# Agent configuration

This file is the entry point for coding agents (OpenCode, Claude Code, etc.)
working in this repo.

## Agent skills

### Issue tracker

Issues and specs for this repo live as GitHub issues, operated via the `gh`
CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default five labels: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See
`docs/agents/domain.md`.