-- Organization Credits & Credit Transactions
-- Supports BYOK + credit pack billing for AI features

CREATE TABLE IF NOT EXISTS "organization_credits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL UNIQUE,
  "balance" integer NOT NULL DEFAULT 0,
  "monthly_allowance" integer NOT NULL DEFAULT 0,
  "last_refreshed_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "credit_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "amount" integer NOT NULL,
  "type" varchar(30) NOT NULL,
  "description" text,
  "stripe_session_id" varchar(255),
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "credit_transactions_org_idx" ON "credit_transactions" ("organization_id");
CREATE INDEX IF NOT EXISTS "credit_transactions_type_idx" ON "credit_transactions" ("type");
CREATE INDEX IF NOT EXISTS "credit_transactions_created_at_idx" ON "credit_transactions" ("created_at");

-- Set Pro/Enterprise monthly AI credit allowances
UPDATE pricing_tiers
SET features = features || '{"aiEmbeddings": true, "monthlyAiCredits": 2000}'::jsonb
WHERE name = 'pro';

UPDATE pricing_tiers
SET features = features || '{"aiEmbeddings": true, "monthlyAiCredits": 10000}'::jsonb
WHERE name = 'enterprise';
