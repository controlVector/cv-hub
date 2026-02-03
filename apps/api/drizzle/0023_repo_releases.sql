-- FEAT-011: Repository Releases & Release Assets
-- Adds repo_releases and repo_release_assets tables

CREATE TABLE IF NOT EXISTS "repo_releases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "repository_id" uuid NOT NULL REFERENCES "repositories"("id") ON DELETE CASCADE,
  "tag_name" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "body" text,
  "draft" boolean DEFAULT false NOT NULL,
  "prerelease" boolean DEFAULT false NOT NULL,
  "author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "repo_releases_repo_tag_idx" ON "repo_releases" USING btree ("repository_id", "tag_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repo_releases_repo_id_idx" ON "repo_releases" USING btree ("repository_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repo_releases_author_id_idx" ON "repo_releases" USING btree ("author_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repo_releases_published_at_idx" ON "repo_releases" USING btree ("published_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "repo_release_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "release_id" uuid NOT NULL REFERENCES "repo_releases"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "content_type" varchar(255) DEFAULT 'application/octet-stream' NOT NULL,
  "size" bigint DEFAULT 0 NOT NULL,
  "download_count" integer DEFAULT 0 NOT NULL,
  "storage_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "repo_release_assets_release_id_idx" ON "repo_release_assets" USING btree ("release_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repo_release_assets_release_name_idx" ON "repo_release_assets" USING btree ("release_id", "name");
