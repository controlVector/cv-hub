-- Task Events: Structured streaming events for executor ↔ planner communication
-- Replaces unstructured task_logs for real-time bidirectional thinking stream

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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  event_type task_event_type NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  needs_response BOOLEAN NOT NULL DEFAULT FALSE,
  response JSONB,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_events_task_id ON task_events(task_id, created_at ASC);
CREATE INDEX idx_task_events_needs_response ON task_events(task_id, needs_response)
  WHERE needs_response = TRUE AND responded_at IS NULL;
