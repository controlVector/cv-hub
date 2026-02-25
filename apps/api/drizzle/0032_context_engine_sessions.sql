-- Context Engine Sessions
-- Tracks per-session state for the context engine

CREATE TABLE IF NOT EXISTS "context_engine_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" varchar(128) NOT NULL,
  "executor_id" uuid REFERENCES "agent_executors"("id") ON DELETE SET NULL,
  "repository_id" uuid NOT NULL REFERENCES "repositories"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "active_concern" varchar(50) NOT NULL DEFAULT 'codebase',
  "last_turn_count" integer NOT NULL DEFAULT 0,
  "last_token_est" integer NOT NULL DEFAULT 0,
  "injected_files" jsonb DEFAULT '[]'::jsonb,
  "injected_symbols" jsonb DEFAULT '[]'::jsonb,
  "checkpoint_summary" text,
  "checkpoint_files" jsonb,
  "checkpoint_symbols" jsonb,
  "last_activity_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "context_engine_sessions_session_repo_idx"
  ON "context_engine_sessions" ("session_id", "repository_id");
CREATE INDEX IF NOT EXISTS "context_engine_sessions_user_idx"
  ON "context_engine_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "context_engine_sessions_repo_idx"
  ON "context_engine_sessions" ("repository_id");
CREATE INDEX IF NOT EXISTS "context_engine_sessions_executor_idx"
  ON "context_engine_sessions" ("executor_id");
