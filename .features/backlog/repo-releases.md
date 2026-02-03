---
id: FEAT-011
title: Repository Releases & Release Assets
priority: high
effort: medium
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: [FEAT-008]
---

# Repository Releases & Release Assets

## Problem

Repositories have git tags but no release management. Users cannot create release notes, upload binary assets, or mark pre-releases. The existing `releases` table in the app-store schema serves a different purpose (app distribution). Repositories need their own release system.

## Solution

Create a separate repository releases system (distinct from the app-store) that ties to git tags and supports markdown release notes plus downloadable assets.

## Acceptance Criteria

- [ ] Schema: `repo_releases` table (id, repository_id, tag_name, name, body, draft, prerelease, author_id, published_at, created_at)
- [ ] Schema: `repo_release_assets` table (id, release_id, name, content_type, size, download_count, storage_key, created_at)
- [ ] Service: `createRelease()`, `updateRelease()`, `deleteRelease()`, `listReleases()`, `getRelease()`
- [ ] Service: `uploadAsset()`, `deleteAsset()`, `getAssetDownloadUrl()`
- [ ] Routes: `GET /api/repos/:owner/:repo/releases` - list releases
- [ ] Routes: `POST /api/repos/:owner/:repo/releases` - create release
- [ ] Routes: `GET /api/repos/:owner/:repo/releases/:id` - get release
- [ ] Routes: `PATCH /api/repos/:owner/:repo/releases/:id` - update release
- [ ] Routes: `DELETE /api/repos/:owner/:repo/releases/:id` - delete release
- [ ] Routes: `POST /api/repos/:owner/:repo/releases/:id/assets` - upload asset
- [ ] Routes: `GET /api/repos/:owner/:repo/releases/latest` - latest release
- [ ] Release auto-creates git tag if it doesn't exist
- [ ] Markdown body rendering support
- [ ] Asset storage via S3 or local filesystem
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**New files:**
- `apps/api/src/db/schema/repo-releases.ts`
- `apps/api/src/services/release.service.ts`
- `apps/api/src/routes/releases.ts`

**Files to modify:**
- `apps/api/src/db/schema/index.ts` - Export release schema
- `apps/api/src/app.ts` - Mount release routes

**Key considerations:**
- Reuse existing S3 storage configuration for assets
- Keep separate from app-store releases schema
- Support auto-generated release notes from commit history between tags
- Draft releases should not be publicly visible
