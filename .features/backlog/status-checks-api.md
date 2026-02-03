---
id: FEAT-012
title: Commit Status Checks API
priority: high
effort: medium
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: [FEAT-008]
blocks: []
---

# Commit Status Checks API

## Problem

Branch protection supports `requireStatusChecks` but the `checkStatusChecks()` function is a stub that always returns `allowed: true`. There are no API endpoints for external CI/CD systems to report commit statuses. This means branch protection rules requiring status checks are effectively bypassed.

## Solution

Implement a commit status API (GitHub-compatible) that allows external systems to report build/test status for specific commits, and wire it into the branch protection validation.

## Acceptance Criteria

- [ ] Schema: `commit_statuses` table (id, repository_id, sha, state, context, description, target_url, creator_id, created_at)
- [ ] State values: pending, success, failure, error
- [ ] Service: `createCommitStatus()`, `getCommitStatuses()`, `getCombinedStatus()`
- [ ] Routes: `POST /api/repos/:owner/:repo/statuses/:sha` - create status
- [ ] Routes: `GET /api/repos/:owner/:repo/commits/:sha/statuses` - list statuses
- [ ] Routes: `GET /api/repos/:owner/:repo/commits/:sha/status` - combined status
- [ ] `checkStatusChecks()` in branch-protection.service.ts queries real status data
- [ ] Combined status logic: all required checks must be `success`
- [ ] Status checks visible on PR page
- [ ] OAuth/PAT authentication for status creation (CI/CD tokens)
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**New files:**
- `apps/api/src/db/schema/commit-statuses.ts`
- `apps/api/src/services/commit-status.service.ts`
- `apps/api/src/routes/commit-statuses.ts`

**Files to modify:**
- `apps/api/src/db/schema/index.ts` - Export schema
- `apps/api/src/app.ts` - Mount routes
- `apps/api/src/services/branch-protection.service.ts` - Wire `checkStatusChecks()` to real data

**Key considerations:**
- Context is the check name (e.g., "ci/tests", "ci/lint")
- Multiple statuses per context allowed (latest wins)
- Combined status: if ANY required check is not `success`, block
- Rate limit status creation per SHA
