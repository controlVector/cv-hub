DO $$ BEGIN
  CREATE TYPE "notification_type" AS ENUM (
    'pr_review',
    'pr_merged',
    'pr_comment',
    'issue_assigned',
    'issue_comment',
    'mention',
    'repo_push',
    'release'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" "notification_type" NOT NULL,
  "title" varchar(255) NOT NULL,
  "body" text,
  "related_entity_type" varchar(50),
  "related_entity_id" uuid,
  "actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" "notification_type" NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "email_enabled" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_id_idx" ON "notifications" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_read_idx" ON "notifications" USING btree ("user_id", "read_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_type_idx" ON "notifications" USING btree ("user_id", "type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_created_at_idx" ON "notifications" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_prefs_user_idx" ON "notification_preferences" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_prefs_user_type_idx" ON "notification_preferences" USING btree ("user_id", "type");
