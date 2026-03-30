-- Migration: Create task_events table
-- Applied: 2026-03-30
-- Context: Table was defined in Drizzle schema (agent-bridge.ts) but migration
--          was never generated/applied. Routes and services already reference it.

CREATE TYPE task_event_type AS ENUM (
  'thinking',
  'decision',
  'question',
  'progress',
  'file_change',
  'error',
  'approval_request',
  'completed',
  'redirect'
);

CREATE TABLE IF NOT EXISTS task_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  event_type      task_event_type NOT NULL,
  content         JSONB NOT NULL DEFAULT '{}',
  needs_response  BOOLEAN NOT NULL DEFAULT false,
  response        JSONB,
  responded_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_events_needs_response ON task_events(task_id, needs_response);
