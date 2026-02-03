---
id: FEAT-025
title: Merge Queue
priority: low
effort: large
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: [FEAT-012]
blocks: []
---

# Merge Queue

## Problem

When multiple PRs are ready to merge, they can conflict with each other or break tests that pass individually but fail when combined. A merge queue tests PRs in sequence, ensuring each one passes with the latest base branch.

## Solution

Implement a merge queue that processes PRs one at a time, rebasing each on the latest target branch and running status checks before merging.

## Acceptance Criteria

- [ ] Schema: `merge_queue_entries` table (id, repository_id, pr_id, position, status, queued_at, started_at, completed_at)
- [ ] Service: `enqueue()`, `dequeue()`, `processNext()`, `getQueuePosition()`
- [ ] Routes: `POST /api/repos/:owner/:repo/merge-queue/:prId` - add to queue
- [ ] Routes: `DELETE /api/repos/:owner/:repo/merge-queue/:prId` - remove from queue
- [ ] Routes: `GET /api/repos/:owner/:repo/merge-queue` - view queue
- [ ] Auto-rebase PR on latest target branch before testing
- [ ] Wait for all required status checks to pass
- [ ] Auto-merge on success, remove from queue on failure
- [ ] Notify PR author on queue status changes
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**New files:**
- `apps/api/src/db/schema/merge-queue.ts`
- `apps/api/src/services/merge-queue.service.ts`
- `apps/api/src/routes/merge-queue.ts`

**Key considerations:**
- Background worker processes queue entries
- Use Redis for queue ordering
- Batch testing: test multiple PRs together when possible
- Cancel in-progress tests when earlier queue entries fail
