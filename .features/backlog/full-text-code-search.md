---
id: FEAT-019
title: Full-Text Code Search
priority: medium
effort: large
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: []
---

# Full-Text Code Search

## Problem

Semantic search via Qdrant embeddings exists, but there is no full-text/regex code search. Users cannot search for exact strings, function names, or patterns across repositories like they can on GitHub.

## Solution

Implement full-text code search using PostgreSQL full-text search (FTS) or a dedicated search engine. Index file contents on push events.

## Acceptance Criteria

- [ ] Schema: `code_search_index` table (id, repository_id, file_path, content_hash, indexed_content, language, updated_at)
- [ ] Service: `indexFile()`, `removeFile()`, `searchCode()`
- [ ] Routes: `GET /api/search/code?q=term&repo=owner/repo&lang=typescript&path=src/`
- [ ] Full-text search with ranking by relevance
- [ ] Filter by: repository, language, file path pattern
- [ ] Syntax: exact phrases (`"function foo"`), exclusion (`-test`), file path (`path:src/`)
- [ ] Results include file path, matched lines, line numbers, context
- [ ] Index updated on push events (git HTTP + SSH)
- [ ] Incremental indexing (only changed files)
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**New files:**
- `apps/api/src/services/code-search.service.ts`
- `apps/api/src/routes/search.ts`

**Files to modify:**
- `apps/api/src/app.ts` - Mount search routes
- `apps/api/src/services/git/sync.service.ts` - Trigger indexing on push

**Key considerations:**
- PostgreSQL FTS with `tsvector` is simplest to deploy (no new infrastructure)
- Use `ts_rank()` for relevance scoring
- File content stored as text with GIN index
- Consider language-aware tokenization (identifier splitting: `camelCase` → `camel`, `case`)
- Max file size for indexing: 1MB
- Skip binary files
