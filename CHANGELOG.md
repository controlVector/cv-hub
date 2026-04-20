# Changelog

All notable changes to CV-Hub will be documented in this file.

## [1.1.0] - 2026-04-20

### Fixed
- **task_event_type enum accepts output streaming types** — cv-agent v1.2.0 posts `output` and `output_final` events, but the enum was missing them and PostgreSQL rejected inserts. All streamed Claude Code stdout from remote executors was silently lost. Fix ships in migration `0040_task_event_output_types.sql` and the matching Zod validator extension.

### Added
- **`sequence_number` on task_events** (nullable BIGINT) — executors can stamp a monotonic index so ordered streaming output is reconstructible even under same-millisecond bursts. Queries now order by `(sequence_number, created_at)`.
- **64KB payload cap on POST `/api/v1/tasks/:taskId/events`** — returns HTTP 413 with a structured error instead of letting oversized events bloat the DB.
- **`cv_task_stream` MCP tool** — new `event_types` filter, ordered by `sequence_number`, description now mentions `output` / `output_final`.
- **`get_task_logs` MCP tool** — new `log_types` filter, description now directs callers to `details.output_chunk` for raw stdout and to `cv_task_stream` for synthesized output.
- **Regression tests** for new event types, sequence_number round-trip, 64KB rejection, and legacy event-type compatibility.

## [1.0.0] - 2026-03-23

### Added

#### Context Manifold Integration (Sprint 5)
- **Bandit feedback hook** — Task outcomes train the contextual scorer via LinUCB updates
- **Transition learning** — Event sequences from completed tasks train the Markov model
- **Deploy outcome service** — Deploy events create Decision nodes in context version graphs
- **Enrichment scoring** — Task dispatch ranks context nodes by bandit average reward

#### MCP Gateway
- **Remote MCP server** — Expose CV-Hub tools to cloud Claude.ai via MCP protocol

#### API & Infrastructure
- **Git hosting** — Full git HTTP backend with push/pull support
- **Repository management** — Create, browse, diff, and search repositories
- **Knowledge graph** — FalkorDB-powered code graph with semantic search
- **CI/CD pipelines** — AI-generated pipeline creation, execution, failure analysis
- **Task dispatch** — Executor registration, task polling, SSE streaming, prompt relay
- **Stripe billing** — Subscription management with webhook handling
