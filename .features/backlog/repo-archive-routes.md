---
id: FEAT-014
title: Repository Archive/Unarchive Routes
priority: medium
effort: small
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: []
---

# Repository Archive/Unarchive Routes

## Problem

The `setRepositoryArchived()` function exists in repository.service.ts but has no HTTP routes exposed. Users cannot archive or unarchive repositories via the API.

## Solution

Add routes that call the existing service function.

## Acceptance Criteria

- [ ] Route: `POST /api/repos/:owner/:repo/archive` - archive repo
- [ ] Route: `DELETE /api/repos/:owner/:repo/archive` - unarchive repo
- [ ] Only repo admins or owners can archive/unarchive
- [ ] Archived repos reject write operations (push, PR merge, issue create)
- [ ] Returns 200 with updated repository data
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**Files to modify:**
- `apps/api/src/routes/repositories.ts` - Add archive/unarchive endpoints

**Key considerations:**
- Verify `canUserWriteToRepo()` already blocks writes to archived repos
- Consider adding an "archived" banner to the frontend repo page
