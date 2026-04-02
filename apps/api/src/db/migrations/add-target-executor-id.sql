-- Migration: Add target_executor_id to agent_tasks for executor-targeted task routing
-- Date: 2026-04-02
-- Context: Tasks dispatched via create_task MCP tool can now target a specific executor.
--          The 4-pass routing in claimNextTask() uses this column for Pass 1 (direct targeting).

-- Add the column (nullable, FK to agent_executors)
ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS target_executor_id UUID
  REFERENCES agent_executors(id) ON DELETE SET NULL;

-- Index for efficient lookup during polling
CREATE INDEX IF NOT EXISTS agent_tasks_target_executor_idx
  ON agent_tasks (target_executor_id);
