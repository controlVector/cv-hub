---
id: FEAT-032
title: Cross-Repository Graph Linking
priority: low
effort: large
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: [FEAT-024]
blocks: []
---

# Cross-Repository Graph Linking

## Problem

FalkorDB knowledge graph tracks code relationships within a single repository, but cannot show relationships across repositories. When libraries are shared between repos, there's no way to understand the cross-repo dependency and usage patterns.

## Solution

Extend the graph model to link symbols across repositories based on import/dependency relationships.

## Acceptance Criteria

- [ ] Service: `linkCrossRepoSymbols(repoId)` - find and create cross-repo edges
- [ ] Service: `getDownstreamUsages(symbolId)` - find all repos using a symbol
- [ ] Service: `getUpstreamDependencies(repoId)` - graph of all dependencies
- [ ] Routes: `GET /api/repos/:owner/:repo/graph/dependencies` - dependency graph
- [ ] Routes: `GET /api/repos/:owner/:repo/graph/dependents` - reverse dependencies
- [ ] Cross-repo edges in FalkorDB: `DEPENDS_ON`, `IMPORTS_FROM`, `EXTENDS`
- [ ] Auto-detect internal package references (monorepo-aware)
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**Files to modify:**
- `apps/api/src/services/graph.service.ts` - Cross-repo linking
- `apps/api/src/services/graph-sync.service.ts` - Trigger on sync

**Key considerations:**
- Match symbols by fully-qualified name across repos
- Handle version conflicts (different versions of same dependency)
- This is computationally expensive - run as background job
- Start with npm/package.json dependencies, expand to other ecosystems
