---
id: FEAT-017
title: CODEOWNERS File Support
priority: medium
effort: small
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: []
---

# CODEOWNERS File Support

## Problem

No mechanism to define code ownership patterns. Teams cannot automatically assign PR reviewers based on which files are changed.

## Solution

Parse CODEOWNERS files from repositories and use them to auto-suggest reviewers on pull requests.

## Acceptance Criteria

- [ ] Service: `parseCODEOWNERS(repoId)` reads and parses the CODEOWNERS file
- [ ] Service: `getOwnersForPaths(repoId, filePaths)` returns owners for given file paths
- [ ] Supports CODEOWNERS in root, `.github/`, or `docs/` directories
- [ ] Pattern matching: glob patterns (`*.js`, `src/api/**`)
- [ ] Owner format: `@username`, `@org/team-name`, email
- [ ] Routes: `GET /api/repos/:owner/:repo/codeowners` - parsed CODEOWNERS data
- [ ] Auto-suggest reviewers on PR creation based on changed files
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**New files:**
- `apps/api/src/services/codeowners.service.ts`

**Files to modify:**
- `apps/api/src/services/pr.service.ts` - Suggest reviewers on PR creation

**Key considerations:**
- Read CODEOWNERS via git-backend.service.ts `getBlob()`
- Last matching pattern wins (like .gitignore)
- Cache parsed results per commit SHA
- Don't block PR creation if CODEOWNERS parsing fails
