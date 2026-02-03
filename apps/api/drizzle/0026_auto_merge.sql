ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "auto_merge_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "auto_merge_method" varchar(10);
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "auto_merge_enabled_by" uuid;
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "auto_merge_enabled_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_auto_merge_enabled_by_users_id_fk" FOREIGN KEY ("auto_merge_enabled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
