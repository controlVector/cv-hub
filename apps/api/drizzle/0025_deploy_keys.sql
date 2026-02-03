CREATE TABLE IF NOT EXISTS "deploy_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"public_key" varchar(2048) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"key_type" varchar(32),
	"read_only" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deploy_keys" ADD CONSTRAINT "deploy_keys_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deploy_keys_fingerprint_idx" ON "deploy_keys" USING btree ("fingerprint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deploy_keys_repo_id_idx" ON "deploy_keys" USING btree ("repository_id");
