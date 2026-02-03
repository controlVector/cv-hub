---
id: FEAT-022
title: Contribution Graphs & Stats
priority: low
effort: small
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: []
---

# Contribution Graphs & Stats

## Problem

Frontend has a `CommitHistoryPage.tsx` but there is no backend API for aggregated contribution statistics. Users cannot see contribution heatmaps, commit frequency, or contributor rankings.

## Solution

Create API endpoints that aggregate existing commit data into contribution statistics suitable for rendering graphs.

## Acceptance Criteria

- [ ] Service: `getContributionStats(userId, { year })` - daily commit counts
- [ ] Service: `getRepoContributors(repoId, { limit })` - top contributors with commit counts
- [ ] Service: `getCommitFrequency(repoId, { period })` - commits per day/week/month
- [ ] Routes: `GET /api/users/:username/contributions` - contribution heatmap data
- [ ] Routes: `GET /api/repos/:owner/:repo/contributors` - contributor list with stats
- [ ] Routes: `GET /api/repos/:owner/:repo/stats/commit-frequency` - commit frequency data
- [ ] Returns data in format suitable for rendering calendar heatmap
- [ ] Aggregates from commits table in database
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**New files:**
- `apps/api/src/services/contribution.service.ts`
- `apps/api/src/routes/contributions.ts`

**Files to modify:**
- `apps/api/src/app.ts` - Mount routes

**Key considerations:**
- Aggregate from existing `commits` table using SQL GROUP BY
- Cache aggregated results (they don't change often)
- Contribution heatmap: 365 days of data, count per day
- Consider timezone handling for day boundaries
