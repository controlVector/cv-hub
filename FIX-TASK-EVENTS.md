# CV-Hub Fix: Task Events Table + Output Visibility

**Priority: CRITICAL**
**Target: cv-hub server (DigitalOcean Kubernetes)**

## Problem

The planner (Claude.ai via MCP) cannot see executor console output. The cv-agent (`cva`) already sends:

1. **Structured events** via `POST /api/v1/tasks/{id}/events` — [THINKING], [DECISION], [QUESTION], [PROGRESS], completion events
2. **Output chunks** via `POST /api/v1/executors/{id}/tasks/{id}/log` with `details.output_chunk` (every 4KB of Claude Code stdout)
3. **Questions** that need planner responses via the events system with `needs_response: true`

But the server side is broken:

- `task_events` table **does not exist** — `cv_task_summary` MCP tool fails with `relation "task_events" does not exist`
- `task_logs.details` JSON column is either not being persisted or not being returned by the MCP `get_task_logs` tool — it always shows `null`
- `cv_task_stream` MCP tool doesn't work (same missing table)
- The planner has **zero visibility** into what the executor actually did or output

## Root Cause

The database migration for `task_events` was never run. The `task_logs` table exists but the `details` JSONB column may not be included in the SELECT or INSERT for the log endpoints.

## Fix Specification

### 1. Create `task_events` table

```sql
CREATE TABLE IF NOT EXISTS task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  content JSONB,
  needs_response BOOLEAN DEFAULT FALSE,
  response JSONB DEFAULT NULL,
  responded_at TIMESTAMPTZ DEFAULT NULL,
  responded_by VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_task_events_task_id ON task_events(task_id);
CREATE INDEX idx_task_events_task_id_type ON task_events(task_id, event_type);
CREATE INDEX idx_task_events_needs_response ON task_events(task_id, needs_response) WHERE needs_response = TRUE AND response IS NULL;
```

### 2. Implement the events API endpoints

The cv-agent already calls these endpoints. They need to actually work:

**POST `/api/v1/tasks/:taskId/events`**
```
Body: { event_type: string, content: string|object, needs_response?: boolean }
Response: { id: uuid, event_type: string, created_at: timestamp }
```
- Insert into `task_events`
- Return the created event with its `id` (the agent uses this ID to poll for responses)

**GET `/api/v1/tasks/:taskId/events`**
```
Query params: ?after_id=uuid&after_timestamp=iso8601&limit=200
Response: Array of task_events rows
```
- Used by both `cv_task_stream` MCP tool and the agent's `getEventResponse` / `getRedirects` functions
- Must include `response` and `responded_at` fields for each event

**POST `/api/v1/tasks/:taskId/events/:eventId/respond`**
(or PATCH, whatever the MCP `cv_task_respond` tool calls)
```
Body: { response: string|object }
```
- Updates `task_events` SET response = body.response, responded_at = NOW(), responded_by = authenticated_user
- The executor is polling for this response to continue working

### 3. Fix `task_logs.details` persistence

Check the task log INSERT query. The `sendTaskLog` function sends:
```json
{
  "log_type": "progress",
  "message": "Claude Code output",
  "details": { "output_chunk": "...4KB of stdout..." },
  "progress_pct": null
}
```

Ensure:
- The INSERT includes `details` in the column list
- The SELECT in `get_task_logs` returns the `details` JSONB column
- The MCP tool `get_task_logs` includes `details` in its response

### 4. Fix MCP tool implementations

**`cv_task_summary`** — Should query `task_events` and return:
```json
{
  "task_id": "...",
  "status": "running",
  "latest_thinking": "last [THINKING] event content",
  "latest_decision": "last [DECISION] event content",
  "latest_progress": "last [PROGRESS] event content",
  "pending_questions": [{ "id": "...", "content": "...", "created_at": "..." }],
  "files_changed": ["...from git-type logs..."],
  "event_count": 42,
  "last_event_at": "2026-03-28T..."
}
```

**`cv_task_stream`** — Should return recent events from `task_events` ordered by `created_at`, with optional `after_id` cursor for pagination.

**`cv_task_respond`** — Should update `task_events` SET response = ..., responded_at = NOW(). The `event_id` parameter maps to `task_events.id`.

### 5. Fix `get_task_logs` MCP tool

The current implementation returns:
```json
{
  "id": "...",
  "log_type": "...",
  "message": "...",
  "details": null,
  "progress_pct": null,
  "created_at": "..."
}
```

It must return the actual `details` JSONB value, which contains `output_chunk` for progress logs and file change info for git logs.

## Agent Endpoints Reference (from cv-agent src/utils/api.ts)

The agent already calls these. They must all work:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/tasks/{id}/events` | Post structured event |
| GET | `/api/v1/tasks/{id}/events` | Read events (?after_id, ?after_timestamp, ?limit) |
| POST | `/api/v1/executors/{id}/tasks/{id}/log` | Post task log with details JSON |
| GET | `/api/v1/tasks/{id}/logs` | Read task logs (must include details) |
| POST | `/api/v1/executors/{id}/tasks/{id}/prompt` | Create prompt |
| GET | `/api/v1/executors/{id}/tasks/{id}/prompts/{id}` | Poll prompt response |

## Bonus: Remote Agent Self-Update

Add a special task_type `self_update` that the executor recognizes. When dispatched:

1. Executor receives task with `task_type: 'self_update'`
2. Runs `npm install -g @controlvector/cv-agent@latest`
3. Reports success/failure
4. Restarts itself (exec into the new binary)

This lets the planner push agent updates remotely without SSH access.

## Verification

After deploying:

1. `cv_task_summary` for any recent task — should not error, should return structure
2. `get_task_logs` — `details` field should be populated for progress/git log types
3. Dispatch a new task, call `cv_task_summary` while it runs — should show live thinking/progress
4. Dispatch a task that emits [QUESTION], use `cv_task_respond` to answer it — executor should continue

## Commit Message

```
fix(server): create task_events table + fix task_logs.details visibility

- Add task_events migration (events, responses, indexes)
- Implement POST/GET /api/v1/tasks/:id/events endpoints
- Implement event response endpoint for cv_task_respond
- Fix task_logs INSERT to include details JSONB column
- Fix task_logs SELECT to return details in API response
- Fix MCP tools: cv_task_summary, cv_task_stream, cv_task_respond, get_task_logs
- Add self_update task type for remote agent updates
```
