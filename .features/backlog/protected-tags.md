---
id: FEAT-015
title: Protected Tags
priority: medium
effort: small
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: []
---

# Protected Tags

## Problem

Branch protection prevents force pushes and deletions of branches, but tags have no protection. Users can delete or overwrite release tags, which breaks release integrity.

## Solution

Extend the branch protection system to also handle tag refs (`refs/tags/*`). Reuse existing protection rule infrastructure.

## Acceptance Criteria

- [ ] `validatePush()` checks tag refs in addition to branch refs
- [ ] Protected tag patterns configurable per-repository (e.g., `v*`)
- [ ] Schema: `tag_protection_rules` table or extend existing branch protection
- [ ] Service: `setTagProtection()`, `removeTagProtection()`, `getTagProtection()`
- [ ] Routes: `GET/POST/DELETE /api/repos/:owner/:repo/tag-protection`
- [ ] Protected tags cannot be deleted or force-updated
- [ ] Admin override option
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**Files to modify:**
- `apps/api/src/services/branch-protection.service.ts` - Extend `extractBranchName` to handle `refs/tags/*`
- `apps/api/src/routes/repositories.ts` - Add tag protection endpoints

**Key considerations:**
- Simplest approach: add `isProtected` and `protectionRules` to tags table (matching branches pattern)
- Or create a separate `tag_protection_rules` table for pattern-based matching
- Pattern matching already exists in `matchesBranchPattern()` - reuse it
