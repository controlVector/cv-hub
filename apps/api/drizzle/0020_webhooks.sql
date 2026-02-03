DO $$ BEGIN
  CREATE TYPE "delivery_status" AS ENUM ('pending', 'delivered', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "repository_id" uuid REFERENCES "repositories"("id") ON DELETE CASCADE,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "secret" varchar(255) NOT NULL,
  "content_type" varchar(50) DEFAULT 'application/json' NOT NULL,
  "events" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "webhook_id" uuid NOT NULL REFERENCES "webhooks"("id") ON DELETE CASCADE,
  "event" varchar(50) NOT NULL,
  "action" varchar(50),
  "payload" jsonb NOT NULL,
  "status_code" integer,
  "response_body" text,
  "response_time_ms" integer,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "status" "delivery_status" DEFAULT 'pending' NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhooks_repository_id_idx" ON "webhooks" USING btree ("repository_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhooks_organization_id_idx" ON "webhooks" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhooks_active_idx" ON "webhooks" USING btree ("active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_id_idx" ON "webhook_deliveries" USING btree ("webhook_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_idx" ON "webhook_deliveries" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_created_at_idx" ON "webhook_deliveries" USING btree ("created_at");
