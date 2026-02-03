---
id: FEAT-029
title: Incremental Vector Sync
priority: medium
effort: medium
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: []
---

# Incremental Vector Sync

## Problem

Vector embeddings are currently generated via full repository sync, which is expensive and slow for large repositories. When a single file changes, the entire repo gets re-indexed.

## Solution

Implement delta-based vector sync that only re-embeds changed files on push events.

## Acceptance Criteria

- [ ] Service: `getChangedFiles(repoId, oldSha, newSha)` - diff between commits
- [ ] Service: `syncChangedFiles(repoId, changedFiles)` - re-embed only changes
- [ ] Service: `pruneDeletedFiles(repoId, deletedFiles)` - remove stale vectors
- [ ] Wire into `processPostReceive()` for push-triggered sync
- [ ] Track file content hashes to detect actual content changes (not just touched files)
- [ ] Skip files that haven't changed content (rename-only, permission-only)
- [ ] Batch embedding API calls (max 100 files per batch)
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**Files to modify:**
- `apps/api/src/services/git/sync.service.ts` - Add incremental sync trigger
- `apps/api/src/services/embeddings.service.ts` - Delta embedding logic
- `apps/api/src/services/vector.service.ts` - Upsert/delete vectors

**Key considerations:**
- Use `git diff --name-status oldSha..newSha` to get changed files
- Content hash stored in Qdrant metadata for change detection
- Full resync fallback if delta sync fails or diverges
- Consider rate limiting embedding API calls
