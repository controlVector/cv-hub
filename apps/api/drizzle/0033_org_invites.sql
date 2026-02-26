-- Organization Invites
-- Token-based email invite system for organizations

CREATE TABLE IF NOT EXISTS "org_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "email" varchar(255) NOT NULL,
  "role" "org_role" NOT NULL DEFAULT 'member',
  "token" varchar(128) NOT NULL UNIQUE,
  "invited_by" uuid REFERENCES "users"("id"),
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Prevent duplicate pending invites for the same email+org
CREATE UNIQUE INDEX IF NOT EXISTS "org_invites_org_email_pending_unique"
  ON "org_invites"("organization_id", "email")
  WHERE "accepted_at" IS NULL;

-- Fast token lookup
CREATE INDEX IF NOT EXISTS "org_invites_token_idx" ON "org_invites"("token");
CREATE INDEX IF NOT EXISTS "org_invites_org_id_idx" ON "org_invites"("organization_id");

-- Prevent duplicate memberships at the DB level
CREATE UNIQUE INDEX IF NOT EXISTS "org_members_org_user_unique"
  ON "organization_members"("organization_id", "user_id");
