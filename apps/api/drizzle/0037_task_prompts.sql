-- Migration 0037: Task Prompts (Bidirectional Executor ↔ User Communication)
-- Enables Claude Code to relay questions back to the user via Claude.ai

-- ── Add waiting_for_input to task status enum ──────────────────────────────
ALTER TYPE "agent_task_status" ADD VALUE IF NOT EXISTS 'waiting_for_input' AFTER 'running';

-- ── Prompt type enum ───────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "task_prompt_type" AS ENUM ('question', 'approval', 'choice', 'info');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── task_prompts table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "task_prompts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id" uuid NOT NULL REFERENCES "agent_tasks"("id") ON DELETE CASCADE,
  "prompt_type" "task_prompt_type" NOT NULL DEFAULT 'question',
  "prompt_text" text NOT NULL,
  "options" jsonb,
  "context" jsonb,
  "response" text,
  "responded_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "task_prompts_task_idx"
  ON "task_prompts" ("task_id");

CREATE INDEX IF NOT EXISTS "task_prompts_pending_idx"
  ON "task_prompts" ("task_id")
  WHERE "response" IS NULL;
