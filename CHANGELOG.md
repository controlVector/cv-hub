# Changelog

All notable changes to CV-Hub will be documented in this file.

## [1.2.0] - 2026-04-20

### Added
- **Pull request detail page** (`/dashboard/repositories/:owner/:repo/pulls/:number`) — previously 404'd. Includes header with state + branches, body markdown, merge panel with approval-gate status, review list with state-colored chips, and files-changed summary using the existing `/diff` endpoint.
- **Approve / Request Changes / Comment buttons** in the detail page — calls the existing `POST /pulls/:number/reviews` endpoint. Merge button enables once `requiredReviewers` is satisfied and no `changes_requested` reviews are outstanding.
- **Dashboard PR list cards are now clickable** — navigate to the detail page.
- **`submit_review` MCP tool** — lets Claude.ai (and other MCP clients) approve, request changes, or leave a comment on a PR. Closes the loop that left `merge_pull` blocked by "Requires N approvals" with no way to satisfy it from MCP.

### Changed
- **`PRWithDetails.repository` now includes `ownerSlug`** — every PR fetch path (`by-id`, `by-number`, `getUserPullRequests`, `getUserReviewRequests`) returns a consistent envelope so the UI can build URLs without a separate repo lookup. Backed by a new `shapePR()` helper that unifies shape across fetch paths.
- **`PRWithDetails.reviews`** now returned on every fetch so detail views avoid a second round-trip.

### Fixed
- Closes controlvector/cv-hub#44 — PR review/approve/merge UI was missing; `create_pull` worked via MCP but the flow dead-ended with no way to merge.

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
