-- Migration 0035: MCP Sessions and Agent Bridge Tables
-- Creates tables for MCP session tracking, agent task relay,
-- workflow threads, thread segments, segment edges, and context bridges.

-- ============================================================================
-- Enums
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE "agent_task_status" AS ENUM (
    'pending', 'queued', 'assigned', 'running', 'completed', 'failed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "agent_task_type" AS ENUM (
    'code_change', 'review', 'debug', 'research', 'deploy', 'test', 'custom'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "agent_task_priority" AS ENUM (
    'low', 'medium', 'high', 'critical'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "executor_type" AS ENUM (
    'claude_code', 'cv_git', 'custom'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "executor_status" AS ENUM (
    'online', 'offline', 'busy', 'error'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "thread_status" AS ENUM (
    'active', 'paused', 'completed', 'archived'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "segment_platform" AS ENUM (
    'claude_ai', 'claude_code', 'cv_hub_api'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "segment_type" AS ENUM (
    'planning', 'execution', 'review', 'research', 'debugging'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "edge_type" AS ENUM (
    'continuation', 'fork', 'merge', 'handoff'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "bridge_type" AS ENUM (
    'task_dispatch', 'result_return', 'context_share', 'handoff'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "bridge_status" AS ENUM (
    'pending', 'accepted', 'rejected', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "mcp_transport" AS ENUM (
    'streamable_http', 'sse'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "mcp_session_status" AS ENUM (
    'active', 'closed', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- Agent Executors (skip if already exists from earlier migration)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "agent_executors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" varchar(100) NOT NULL,
  "type" "executor_type" DEFAULT 'claude_code' NOT NULL,
  "status" "executor_status" DEFAULT 'offline' NOT NULL,
  "capabilities" jsonb,
  "workspace_root" text,
  "repository_id" uuid REFERENCES "repositories"("id") ON DELETE SET NULL,
  "registration_token" varchar(64),
  "last_heartbeat_at" timestamp with time zone,
  "last_task_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "agent_executors_user_id_idx" ON "agent_executors" ("user_id");
CREATE INDEX IF NOT EXISTS "agent_executors_status_idx" ON "agent_executors" ("status");
CREATE INDEX IF NOT EXISTS "agent_executors_type_idx" ON "agent_executors" ("type");
CREATE INDEX IF NOT EXISTS "agent_executors_repo_idx" ON "agent_executors" ("repository_id");

-- ============================================================================
-- MCP Sessions (Streamable HTTP Session Tracking)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "mcp_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_token" varchar(128) NOT NULL UNIQUE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "client_id" uuid REFERENCES "oauth_clients"("id") ON DELETE SET NULL,
  "transport" "mcp_transport" DEFAULT 'streamable_http' NOT NULL,
  "status" "mcp_session_status" DEFAULT 'active' NOT NULL,
  "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "mcp_sessions_token_idx" ON "mcp_sessions" ("session_token");
CREATE INDEX IF NOT EXISTS "mcp_sessions_user_id_idx" ON "mcp_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "mcp_sessions_status_idx" ON "mcp_sessions" ("status");
CREATE INDEX IF NOT EXISTS "mcp_sessions_expires_idx" ON "mcp_sessions" ("expires_at");

-- ============================================================================
-- Workflow Threads (Top-Level Thread Grouping)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "workflow_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" varchar(255) NOT NULL,
  "description" text,
  "status" "thread_status" DEFAULT 'active' NOT NULL,
  "repository_id" uuid REFERENCES "repositories"("id") ON DELETE SET NULL,
  "total_segments" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "workflow_threads_user_id_idx" ON "workflow_threads" ("user_id");
CREATE INDEX IF NOT EXISTS "workflow_threads_status_idx" ON "workflow_threads" ("status");
CREATE INDEX IF NOT EXISTS "workflow_threads_repo_idx" ON "workflow_threads" ("repository_id");

-- ============================================================================
-- Thread Segments (Individual Segments Within Threads)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "thread_segments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "thread_id" uuid NOT NULL REFERENCES "workflow_threads"("id") ON DELETE CASCADE,
  "platform" "segment_platform" NOT NULL,
  "session_identifier" varchar(255),
  "segment_type" "segment_type" DEFAULT 'execution' NOT NULL,
  "title" varchar(255),
  "summary" text,
  "context_snapshot" jsonb,
  "result_snapshot" jsonb,
  "tools_used" jsonb,
  "files_modified" jsonb,
  "started_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "thread_segments_thread_id_idx" ON "thread_segments" ("thread_id");
CREATE INDEX IF NOT EXISTS "thread_segments_platform_idx" ON "thread_segments" ("platform");
CREATE INDEX IF NOT EXISTS "thread_segments_session_idx" ON "thread_segments" ("session_identifier");
CREATE INDEX IF NOT EXISTS "thread_segments_type_idx" ON "thread_segments" ("segment_type");

-- ============================================================================
-- Context Bridges (Cross-Platform Context Snapshots)
-- Must be created BEFORE thread_segment_edges (which references it)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "context_bridges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "thread_id" uuid NOT NULL REFERENCES "workflow_threads"("id") ON DELETE CASCADE,
  "from_segment_id" uuid NOT NULL REFERENCES "thread_segments"("id") ON DELETE CASCADE,
  "to_segment_id" uuid REFERENCES "thread_segments"("id") ON DELETE SET NULL,
  "bridge_type" "bridge_type" DEFAULT 'context_share' NOT NULL,
  "context_payload" jsonb NOT NULL,
  "status" "bridge_status" DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "context_bridges_thread_idx" ON "context_bridges" ("thread_id");
CREATE INDEX IF NOT EXISTS "context_bridges_from_segment_idx" ON "context_bridges" ("from_segment_id");
CREATE INDEX IF NOT EXISTS "context_bridges_status_idx" ON "context_bridges" ("status");

-- ============================================================================
-- Thread Segment Edges (DAG Edges Between Segments)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "thread_segment_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "thread_id" uuid NOT NULL REFERENCES "workflow_threads"("id") ON DELETE CASCADE,
  "from_segment_id" uuid NOT NULL REFERENCES "thread_segments"("id") ON DELETE CASCADE,
  "to_segment_id" uuid NOT NULL REFERENCES "thread_segments"("id") ON DELETE CASCADE,
  "edge_type" "edge_type" DEFAULT 'continuation' NOT NULL,
  "bridge_id" uuid REFERENCES "context_bridges"("id") ON DELETE SET NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "thread_segment_edges_thread_idx" ON "thread_segment_edges" ("thread_id");
CREATE INDEX IF NOT EXISTS "thread_segment_edges_from_idx" ON "thread_segment_edges" ("from_segment_id");
CREATE INDEX IF NOT EXISTS "thread_segment_edges_to_idx" ON "thread_segment_edges" ("to_segment_id");

-- Unique constraint on (from, to, edge_type)
DO $$ BEGIN
  ALTER TABLE "thread_segment_edges"
    ADD CONSTRAINT "thread_segment_edges_unique"
    UNIQUE ("from_segment_id", "to_segment_id", "edge_type");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

-- ============================================================================
-- Agent Tasks (Task Relay Between Platforms)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "agent_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "executor_id" uuid REFERENCES "agent_executors"("id") ON DELETE SET NULL,
  "thread_id" uuid REFERENCES "workflow_threads"("id") ON DELETE SET NULL,
  "title" varchar(255) NOT NULL,
  "description" text,
  "task_type" "agent_task_type" DEFAULT 'custom' NOT NULL,
  "status" "agent_task_status" DEFAULT 'pending' NOT NULL,
  "priority" "agent_task_priority" DEFAULT 'medium' NOT NULL,
  "input" jsonb,
  "result" jsonb,
  "error" text,
  "repository_id" uuid REFERENCES "repositories"("id") ON DELETE SET NULL,
  "branch" varchar(255),
  "file_paths" jsonb,
  "mcp_session_id" uuid REFERENCES "mcp_sessions"("id") ON DELETE SET NULL,
  "parent_task_id" uuid,
  "metadata" jsonb,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "timeout_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "agent_tasks_user_id_idx" ON "agent_tasks" ("user_id");
CREATE INDEX IF NOT EXISTS "agent_tasks_executor_id_idx" ON "agent_tasks" ("executor_id");
CREATE INDEX IF NOT EXISTS "agent_tasks_thread_id_idx" ON "agent_tasks" ("thread_id");
CREATE INDEX IF NOT EXISTS "agent_tasks_status_idx" ON "agent_tasks" ("status");
CREATE INDEX IF NOT EXISTS "agent_tasks_priority_idx" ON "agent_tasks" ("priority");
CREATE INDEX IF NOT EXISTS "agent_tasks_repo_idx" ON "agent_tasks" ("repository_id");
CREATE INDEX IF NOT EXISTS "agent_tasks_mcp_session_idx" ON "agent_tasks" ("mcp_session_id");
CREATE INDEX IF NOT EXISTS "agent_tasks_parent_idx" ON "agent_tasks" ("parent_task_id");
