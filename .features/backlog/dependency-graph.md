---
id: FEAT-024
title: Dependency Graph
priority: low
effort: large
area: api
status: backlog
created: 2026-02-03
updated: 2026-02-03
depends_on: []
blocks: []
---

# Dependency Graph

## Problem

No visibility into project dependencies. Users cannot see what packages a repository depends on, which versions are used, or if any have known vulnerabilities.

## Solution

Parse dependency files (package.json, go.mod, Cargo.toml, requirements.txt, etc.) and build a dependency graph with optional vulnerability checking.

## Acceptance Criteria

- [ ] Service: `parseDependencies(repoId)` - extract deps from manifest files
- [ ] Service: `getDependencyGraph(repoId)` - full dependency tree
- [ ] Routes: `GET /api/repos/:owner/:repo/dependencies` - list dependencies
- [ ] Supported manifests: package.json, go.mod, Cargo.toml, requirements.txt, Gemfile, pom.xml
- [ ] Dependency type: runtime, dev, optional, peer
- [ ] Version constraints parsed and stored
- [ ] Auto-refresh on push events
- [ ] Tests pass
- [ ] No TypeScript errors

## Technical Notes

**New files:**
- `apps/api/src/db/schema/dependencies.ts`
- `apps/api/src/services/dependency.service.ts`
- `apps/api/src/routes/dependencies.ts`

**Key considerations:**
- Read manifest files via `git-backend.service.ts` getBlob()
- Start with package.json (most relevant for the codebase)
- Vulnerability checking can be a separate feature (integrate with OSV.dev API)
- Store in a graph structure (FalkorDB) for relationship queries
