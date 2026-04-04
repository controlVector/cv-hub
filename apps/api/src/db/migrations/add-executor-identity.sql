-- Migration: Add executor identity and safety metadata
-- Date: 2026-04-04
-- Context: Enables role-based dispatch guards, integration awareness,
--          and self-modification protection for executors.

ALTER TABLE agent_executors ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'development';
ALTER TABLE agent_executors ADD COLUMN IF NOT EXISTS dispatch_guard VARCHAR(20) DEFAULT 'open';
ALTER TABLE agent_executors ADD COLUMN IF NOT EXISTS integration JSONB;
ALTER TABLE agent_executors ADD COLUMN IF NOT EXISTS tags JSONB;
ALTER TABLE agent_executors ADD COLUMN IF NOT EXISTS owner_project VARCHAR(100);

CREATE INDEX IF NOT EXISTS agent_executors_role_idx ON agent_executors (role);
CREATE INDEX IF NOT EXISTS agent_executors_dispatch_guard_idx ON agent_executors (dispatch_guard);
