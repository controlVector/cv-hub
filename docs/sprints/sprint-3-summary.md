# Sprint 3 — Task Event Streaming

Prompt file for Claude Code execution on cv-hub + cv-agent.

## Summary

Replace fire-and-forget task dispatch with real-time bidirectional streaming. Executor emits [THINKING]/[DECISION]/[QUESTION]/[PROGRESS] markers. Planner sees them via SSE and can respond to questions or redirect mid-task. Task dispatch enriched with manifold context from Sprint 2.

## Phases

1. Understand existing task infrastructure (cv-hub + cv-agent)
2. task_events table migration (cv-hub)
3. Task events service (cv-hub)
4. API routes — CRUD + SSE stream (cv-hub)
5. MCP tools — cv_task_stream, cv_task_respond, cv_task_redirect, cv_task_summary (cv-hub)
6. Context-enriched task dispatch (cv-hub)
7. Structured output parser + event emitter (cv-agent)
8. Response delivery to Claude Code (cv-agent)
9. End-to-end lifecycle wiring (cv-hub)
10. Validation

## Depends On

Sprint 1 (scorer) + Sprint 2 (manifold) — both complete.
