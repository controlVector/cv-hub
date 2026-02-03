---
id: FEAT-009
title: Fork Repository Service
priority: high
effort: medium
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: []
---

# Fork Repository Service

## Problem

Users cannot fork repositories. The schema supports `forkedFromId` and `forkCount`, but there is no service layer or routes to actually perform a fork operation. Forking is essential for open-source collaboration workflows (fork → branch → PR).

## Solution

Implement fork as a server-side git clone of the bare repository combined with a new database record linked to the original.

## Acceptance Criteria

- [ ] Service: `forkRepository(sourceRepoId, targetUserId, options?)` creates fork
- [ ] Clones the bare git repository on disk to `{user}/{repo}.git`
- [ ] Creates new repository DB record with `forkedFromId` set
- [ ] Increments `forkCount` on source repository
- [ ] Handles name conflicts (appends `-1`, `-2`, etc.)
- [ ] Routes: `POST /api/repos/:owner/:repo/forks` - create fork
- [ ] Routes: `GET /api/repos/:owner/:repo/forks` - list forks
- [ ] Fork preserves all branches and tags from source
- [ ] Fork can target a user account or an organization
- [ ] Cannot fork a repo you already have a fork of (409 conflict)
- [ ] Cross-fork PR creation supported (PR from fork to upstream)
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**New files:**
- `apps/api/src/services/fork.service.ts`
- `apps/api/src/routes/forks.ts`

**Files to modify:**
- `apps/api/src/app.ts` - Mount fork routes
- `apps/api/src/services/repository.service.ts` - Add forkCount update helpers

**Key considerations:**
- Use `git clone --bare` to copy the repository on disk
- Set remote `upstream` on the fork pointing to the source
- Fork should inherit visibility from source (or be configurable)
- Consider quota limits on forks per user
