-- Organization add-ons table (bolt-on subscriptions separate from main plan)
CREATE TABLE IF NOT EXISTS "organization_addons" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"        uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "addon_type"             varchar(32) NOT NULL,               -- e.g. 'mcp_gateway'
  "stripe_subscription_id" varchar(255),
  "stripe_price_id"        varchar(255),
  "status"                 "subscription_status" NOT NULL DEFAULT 'incomplete',
  "billing_interval"       varchar(16),                        -- 'monthly' or 'annual'
  "current_period_start"   timestamp with time zone,
  "current_period_end"     timestamp with time zone,
  "cancel_at_period_end"   boolean NOT NULL DEFAULT false,
  "canceled_at"            timestamp with time zone,
  "metadata"               jsonb,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"             timestamp with time zone NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX "addons_org_id_idx" ON "organization_addons" ("organization_id");
CREATE INDEX "addons_type_idx" ON "organization_addons" ("addon_type");
CREATE INDEX "addons_status_idx" ON "organization_addons" ("status");
CREATE INDEX "addons_stripe_sub_idx" ON "organization_addons" ("stripe_subscription_id");

-- Partial unique: one active add-on of each type per org
CREATE UNIQUE INDEX "addons_org_type_active_idx"
  ON "organization_addons" ("organization_id", "addon_type")
  WHERE "status" IN ('active', 'trialing', 'past_due');

-- Add mcpGateway to pricing_tiers features JSONB
-- starter = false, pro/enterprise = true
UPDATE "pricing_tiers"
SET "features" = "features" || '{"mcpGateway": false}'::jsonb
WHERE "name" = 'starter'
  AND NOT ("features" ? 'mcpGateway');

UPDATE "pricing_tiers"
SET "features" = "features" || '{"mcpGateway": true}'::jsonb
WHERE "name" IN ('pro', 'enterprise')
  AND NOT ("features" ? 'mcpGateway');
