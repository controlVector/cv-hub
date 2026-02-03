---
id: FEAT-023
title: Repository Insights & Analytics
priority: low
effort: medium
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: [FEAT-022]
blocks: []
---

# Repository Insights & Analytics

## Problem

Repositories have basic counts (stars, watchers, forks) but no traffic analytics, language breakdown, or code frequency data. Repo owners cannot understand how their repositories are used.

## Solution

Track repository traffic (clones, views) and compute analytics from git data (language breakdown, code frequency).

## Acceptance Criteria

- [ ] Schema: `repo_traffic` table (repository_id, date, views, unique_viewers, clones, unique_cloners)
- [ ] Service: `trackView()`, `trackClone()` - called on HTTP/SSH access
- [ ] Service: `getTrafficStats(repoId, { days })` - traffic over time
- [ ] Service: `getLanguageBreakdown(repoId)` - bytes per language
- [ ] Service: `getCodeFrequency(repoId)` - additions/deletions per week
- [ ] Routes: `GET /api/repos/:owner/:repo/traffic/views` - view stats
- [ ] Routes: `GET /api/repos/:owner/:repo/traffic/clones` - clone stats
- [ ] Routes: `GET /api/repos/:owner/:repo/languages` - language breakdown
- [ ] Routes: `GET /api/repos/:owner/:repo/stats/code-frequency` - code churn
- [ ] Traffic data retained for 14 days (like GitHub)
- [ ] Only repo admins can see traffic data
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**New files:**
- `apps/api/src/db/schema/repo-traffic.ts`
- `apps/api/src/services/repo-analytics.service.ts`
- `apps/api/src/routes/repo-analytics.ts`

**Files to modify:**
- `apps/api/src/services/git/git-http.service.ts` - Track clones/fetches
- `apps/api/src/services/git/ssh-server.ts` - Track SSH clones

**Key considerations:**
- Language detection: use file extensions or `linguist` patterns
- Code frequency computed from `git log --stat`
- Traffic tracking should be non-blocking
- Unique visitors tracked by IP hash (privacy-preserving)
