---
id: FEAT-013
title: Repository Transfer Routes
priority: medium
effort: small
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: []
---

# Repository Transfer Routes

## Problem

The `transferRepository()` function exists in repository.service.ts but has no HTTP routes exposed. Users cannot transfer repository ownership via the API.

## Solution

Add a route that calls the existing service function with proper authorization checks.

## Acceptance Criteria

- [ ] Route: `POST /api/repos/:owner/:repo/transfer` - initiate transfer
- [ ] Request body: `{ newOwnerType: 'user' | 'organization', newOwnerId: string }`
- [ ] Only repo admins or owners can initiate transfer
- [ ] Moves git directory on disk from old owner path to new owner path
- [ ] Updates database record
- [ ] Returns 200 with updated repository data
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**Files to modify:**
- `apps/api/src/routes/repositories.ts` - Add transfer endpoint

**Key considerations:**
- Verify target user/org exists and transfer initiator has permission
- Handle git directory rename atomically
- Consider adding a confirmation step (transfer request → accept)
