---
id: FEAT-027
title: Git LFS Support
priority: low
effort: xl
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: []
---

# Git LFS Support

## Problem

Large files (binaries, models, datasets) bloat git repositories and make cloning slow. Git LFS replaces large files with pointers and stores the actual content in a separate object store.

## Solution

Implement the Git LFS Batch API, storing LFS objects in S3.

## Acceptance Criteria

- [ ] Schema: `lfs_objects` table (oid, size, repository_id, storage_key, created_at)
- [ ] Schema: `lfs_locks` table (id, repository_id, path, owner_id, locked_at)
- [ ] LFS Batch API: `POST /:owner/:repo.git/info/lfs/objects/batch`
- [ ] LFS Upload: `PUT /:owner/:repo.git/info/lfs/objects/:oid`
- [ ] LFS Download: `GET /:owner/:repo.git/info/lfs/objects/:oid`
- [ ] LFS Verify: `POST /:owner/:repo.git/info/lfs/verify`
- [ ] LFS Locks API: `POST/GET/DELETE /:owner/:repo.git/info/lfs/locks`
- [ ] Objects stored in S3 with configurable bucket
- [ ] Authentication via OAuth/PAT tokens
- [ ] Bandwidth and storage quota tracking per repository
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**New files:**
- `apps/api/src/db/schema/lfs.ts`
- `apps/api/src/services/lfs.service.ts`
- `apps/api/src/routes/lfs.ts`

**Key considerations:**
- LFS uses its own authentication (separate from git HTTP)
- S3 presigned URLs for direct upload/download (bypass API server)
- Content-addressable storage by SHA-256 OID
- Consider LFS transfer adapters (basic vs multipart)
- This is a large effort - consider implementing in phases
