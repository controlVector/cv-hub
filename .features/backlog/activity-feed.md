---
id: FEAT-018
title: Activity Feed / Timeline
priority: medium
effort: medium
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: []
---

# Activity Feed / Timeline

## Problem

No public activity timeline exists for repositories, users, or organizations. Users cannot see recent activity without manually checking each repo's commits, PRs, and issues.

## Solution

Build an activity feed that aggregates events across repositories. Leverage the existing audit log infrastructure as a data source where possible.

## Acceptance Criteria

- [ ] Schema: `activity_events` table (id, actor_id, event_type, repository_id, entity_type, entity_id, metadata, created_at)
- [ ] Service: `logActivity()` called from relevant service functions
- [ ] Service: `getRepoActivity(repoId, { limit, offset, type })` - repo timeline
- [ ] Service: `getUserActivity(userId, { limit, offset })` - user timeline
- [ ] Service: `getOrgActivity(orgId, { limit, offset })` - org timeline
- [ ] Routes: `GET /api/repos/:owner/:repo/activity` - repo activity feed
- [ ] Routes: `GET /api/users/:username/activity` - user activity feed
- [ ] Routes: `GET /api/orgs/:slug/activity` - org activity feed
- [ ] Event types: push, pr_opened, pr_merged, pr_closed, issue_opened, issue_closed, comment, review, release, member_added
- [ ] Pagination with cursor-based navigation
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**New files:**
- `apps/api/src/db/schema/activity.ts`
- `apps/api/src/services/activity.service.ts`
- `apps/api/src/routes/activity.ts`

**Files to modify:**
- `apps/api/src/db/schema/index.ts` - Export schema
- `apps/api/src/app.ts` - Mount routes
- Various services to call `logActivity()`

**Key considerations:**
- Keep activity logging non-blocking (fire and forget)
- Consider using the existing audit_logs table as a source, or create a dedicated one
- Activity events are public for public repos, private for private repos
- Rate limit activity generation (batch rapid successive events)
