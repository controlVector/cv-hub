-- Migration: Add organization_id to personal_access_tokens
-- PATs can now be scoped to an organization, limiting repo access to that org's repos.
-- NULL organization_id = user-scoped PAT (legacy/backward compatible)

ALTER TABLE personal_access_tokens
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS pat_org_id_idx ON personal_access_tokens(organization_id);
