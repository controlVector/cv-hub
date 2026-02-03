DO $$ BEGIN
  CREATE TYPE "status_check_state" AS ENUM ('pending', 'success', 'failure', 'error');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commit_statuses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "repository_id" uuid NOT NULL REFERENCES "repositories"("id") ON DELETE CASCADE,
  "sha" varchar(40) NOT NULL,
  "state" "status_check_state" DEFAULT 'pending' NOT NULL,
  "context" varchar(255) DEFAULT 'default' NOT NULL,
  "description" varchar(255),
  "target_url" text,
  "creator_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commit_statuses_repo_sha_idx" ON "commit_statuses" USING btree ("repository_id", "sha");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commit_statuses_repo_sha_context_idx" ON "commit_statuses" USING btree ("repository_id", "sha", "context");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commit_statuses_state_idx" ON "commit_statuses" USING btree ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commit_statuses_created_at_idx" ON "commit_statuses" USING btree ("created_at");
