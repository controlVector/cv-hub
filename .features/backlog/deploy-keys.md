---
id: FEAT-016
title: Repository Deploy Keys
priority: medium
effort: small
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: []
---

# Repository Deploy Keys

## Problem

There is no way to grant SSH access to a specific repository without giving access to the user's entire account. Deploy keys (per-repository SSH keys) are needed for CI/CD systems and deployment pipelines.

## Solution

Create a deploy keys system scoped to individual repositories, following the same pattern as user SSH keys but with repository-level granularity.

## Acceptance Criteria

- [ ] Schema: `deploy_keys` table (id, repository_id, title, public_key, fingerprint, read_only, last_used_at, created_at)
- [ ] Service: `addDeployKey()`, `removeDeployKey()`, `listDeployKeys()`, `findRepoByDeployKeyFingerprint()`
- [ ] Routes: `GET /api/repos/:owner/:repo/keys` - list deploy keys
- [ ] Routes: `POST /api/repos/:owner/:repo/keys` - add deploy key
- [ ] Routes: `DELETE /api/repos/:owner/:repo/keys/:id` - remove deploy key
- [ ] SSH server checks deploy keys in addition to user keys
- [ ] Read-only deploy keys can clone/fetch but not push
- [ ] A deploy key can only be added to one repository
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**New files:**
- `apps/api/src/db/schema/deploy-keys.ts`
- `apps/api/src/services/deploy-keys.service.ts`
- `apps/api/src/routes/deploy-keys.ts`

**Files to modify:**
- `apps/api/src/db/schema/index.ts` - Export schema
- `apps/api/src/app.ts` - Mount routes
- `apps/api/src/services/git/ssh-server.ts` - Check deploy keys during auth

**Key considerations:**
- Follow the same validation pattern as `apps/api/src/services/ssh-keys.service.ts`
- Fingerprint uniqueness should be global (same key can't be user key AND deploy key)
- Deploy key auth returns the repository directly, not a user
