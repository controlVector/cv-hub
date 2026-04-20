-- Extend task_event_type enum with output streaming types
-- cv-agent v1.2.0+ posts 'output' (periodic stdout chunks) and 'output_final'
-- (end-of-task summary). The original enum rejected these, causing silent
-- INSERT failures and the "executor looks blind" symptom.

ALTER TYPE task_event_type ADD VALUE IF NOT EXISTS 'output';
ALTER TYPE task_event_type ADD VALUE IF NOT EXISTS 'output_final';

-- Ordered streaming: sequence_number lets the agent assign a monotonic index
-- so the planner can reconstruct output deterministically even when many events
-- land within the same millisecond. Nullable for back-compat with existing rows.
ALTER TABLE task_events ADD COLUMN IF NOT EXISTS sequence_number BIGINT;

CREATE INDEX IF NOT EXISTS idx_task_events_task_seq
  ON task_events(task_id, sequence_number)
  WHERE sequence_number IS NOT NULL;
