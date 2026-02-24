-- Repository Summaries table for AI-generated summaries
CREATE TABLE IF NOT EXISTS "repository_summaries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "repository_id" uuid NOT NULL REFERENCES "repositories"("id") ON DELETE CASCADE,
  "summary" text NOT NULL,
  "technologies" jsonb DEFAULT '[]',
  "entry_points" jsonb DEFAULT '[]',
  "key_patterns" jsonb DEFAULT '[]',
  "model" varchar(100) NOT NULL,
  "prompt_tokens" integer DEFAULT 0,
  "completion_tokens" integer DEFAULT 0,
  "graph_sync_job_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "repository_summaries_repo_idx" ON "repository_summaries" ("repository_id");
