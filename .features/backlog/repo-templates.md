---
id: FEAT-020
title: Repository Templates
priority: medium
effort: medium
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: [FEAT-009]
blocks: []
---

# Repository Templates

## Problem

Users cannot create new repositories from templates. Every new repo starts empty, requiring manual setup of boilerplate structure, CI configs, etc.

## Solution

Allow repositories to be marked as templates. New repos can be generated from templates, copying the file structure but not git history.

## Acceptance Criteria

- [ ] Schema: Add `isTemplate` boolean to repositories table
- [ ] Service: `markAsTemplate()`, `unmarkAsTemplate()`
- [ ] Service: `generateFromTemplate(templateRepoId, newOwner, newName)` - create repo from template
- [ ] Routes: `POST /api/repos/:owner/:repo/generate` - create repo from template
- [ ] Routes: `PATCH /api/repos/:owner/:repo` - set `isTemplate` flag
- [ ] Routes: `GET /api/repos/templates` - list available templates
- [ ] Generated repo has a single initial commit with template files
- [ ] Template variables in filenames and content (e.g., `{{REPO_NAME}}`)
- [ ] Template repos show "Use this template" badge
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**Files to modify:**
- `apps/api/src/db/schema/repositories.ts` - Add `isTemplate` column
- `apps/api/src/services/repository.service.ts` - Template operations
- `apps/api/src/routes/repositories.ts` - Template routes

**Key considerations:**
- Copy files via `git archive` + `git init` (no history transfer)
- Variable substitution is optional for v1 (can add later)
- Template repos should be searchable/filterable
