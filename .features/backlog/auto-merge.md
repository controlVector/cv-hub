---
id: FEAT-026
title: Pull Request Auto-Merge
priority: low
effort: small
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: [FEAT-012]
blocks: []
---

# Pull Request Auto-Merge

## Problem

Users must manually merge PRs after all checks pass and reviews are approved. This is tedious when waiting for CI to complete.

## Solution

Allow PR authors to enable auto-merge, which automatically merges the PR once all required conditions are met (status checks pass, required reviews approved).

## Acceptance Criteria

- [ ] Schema: Add `autoMerge` field to pull_requests (merge_method, enabled_by, enabled_at)
- [ ] Service: `enableAutoMerge(prId, mergeMethod)`, `disableAutoMerge(prId)`
- [ ] Service: `checkAutoMergeEligibility(prId)` - called when checks/reviews update
- [ ] Routes: `POST /api/repos/:owner/:repo/pulls/:number/auto-merge` - enable
- [ ] Routes: `DELETE /api/repos/:owner/:repo/pulls/:number/auto-merge` - disable
- [ ] Auto-merge triggers when: all required status checks pass AND required reviews met
- [ ] Auto-merge respects branch protection rules
- [ ] Auto-merge disabled if PR updated (new commits pushed)
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**Files to modify:**
- `apps/api/src/db/schema/repositories.ts` - Add autoMerge fields to pull_requests
- `apps/api/src/services/pr.service.ts` - Auto-merge logic
- `apps/api/src/routes/pull-requests.ts` - Add auto-merge endpoints
- `apps/api/src/services/commit-status.service.ts` - Check auto-merge when status updates (FEAT-012)

**Key considerations:**
- Trigger check on: status update, review submitted, review dismissed
- Use a lightweight polling mechanism or event-driven approach
- Log auto-merge events for audit trail
