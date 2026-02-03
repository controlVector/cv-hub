---
id: FEAT-021
title: Repository Wiki Pages
priority: medium
effort: medium
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: []
---

# Repository Wiki Pages

## Problem

Schema has a `hasWiki` boolean field but there is no wiki content storage, editing, or serving. Users cannot create documentation within their repositories.

## Solution

Implement a wiki system backed by a separate bare git repository per wiki (like GitHub), storing markdown pages with full version history.

## Acceptance Criteria

- [ ] Wiki stored as a separate bare git repo: `{owner}/{repo}.wiki.git`
- [ ] Service: `initWiki()`, `getPage()`, `createPage()`, `updatePage()`, `deletePage()`, `listPages()`
- [ ] Service: `getPageHistory()` - version history for a page
- [ ] Routes: `GET /api/repos/:owner/:repo/wiki` - list pages
- [ ] Routes: `GET /api/repos/:owner/:repo/wiki/:slug` - get page content
- [ ] Routes: `POST /api/repos/:owner/:repo/wiki` - create page
- [ ] Routes: `PUT /api/repos/:owner/:repo/wiki/:slug` - update page
- [ ] Routes: `DELETE /api/repos/:owner/:repo/wiki/:slug` - delete page
- [ ] Routes: `GET /api/repos/:owner/:repo/wiki/:slug/history` - page history
- [ ] Pages stored as markdown files
- [ ] Sidebar navigation auto-generated from page list
- [ ] Wiki cloneable via `git clone` (same as GitHub)
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**New files:**
- `apps/api/src/services/wiki.service.ts`
- `apps/api/src/routes/wiki.ts`

**Files to modify:**
- `apps/api/src/app.ts` - Mount wiki routes

**Key considerations:**
- Reuse `git-backend.service.ts` functions for reading/writing git content
- Each wiki edit is a git commit
- Page slugs are lowercased, hyphenated versions of page titles
- Home page slug is `home` (created on wiki init)
- Consider restricting wiki access based on repo visibility
