# CV-Hub Web App Status Report

**Date:** 2026-01-01
**Last Updated By:** Claude Code Session

---

## Executive Summary

**Frontend: 70% built. Backend: 40% built.**

The UI is a demonstration shell. Code browsing (Sprints 5-6) works. Everything else shows fake data.

---

## Codebase Audit

### Missing Routes (Broken Navigation)

| Route | Referenced From | Status |
|-------|-----------------|--------|
| `/repositories/new` | Layout, Repositories, Dashboard | No route/component |
| `/pull-requests/new` | PullRequests.tsx:220 | No route/component |
| `/pull-requests/:id` | PullRequests.tsx:291 | No route/component |
| `/settings` | Layout.tsx:133 | Only `/settings/security` and `/settings/developer` exist |
| `/repositories/:owner/:repo/graph` | RepositoryDetail.tsx:338 | No route defined |
| `/repositories/:owner/:repo/settings` | RepositoryDetail.tsx:356 | No route defined |

### Stubbed/Unimplemented Functions

| Function | Location | Current State |
|----------|----------|---------------|
| `handleSyncGraph()` | RepositoryDetail.tsx:106 | Logs to console only |
| Branch loading | CommitHistoryPage.tsx:96 | Hardcoded `branches={[]}` |
| Context menu actions | Repositories.tsx:394-398 | All just close menu |
| Graph toolbar buttons | KnowledgeGraph.tsx:306-440 | No handlers |
| Re-run AI Review | PullRequests.tsx:520 | No onClick |

### Pages Using Mock Data (Not Real APIs)

| Page | Mock Variables | Backend Required |
|------|----------------|------------------|
| **Dashboard.tsx** | `stats`, `recentRepos`, `aiInsights`, `recentActivity` | Stats aggregation API, activity feed API |
| **Repositories.tsx** | `mockRepositories` | Already has API - just not wired |
| **PullRequests.tsx** | `mockPRs`, `mockAIReviewIssues` | PR service + AI review integration |
| **KnowledgeGraph.tsx** | `mockNodes`, `mockEdges` | Graph query API (FalkorDB) |
| **Search.tsx** | `mockResults` | Semantic search API (Qdrant) |
| **AIAssistant.tsx** | `mockMessages`, `generateMockResponse()` | LLM integration (OpenRouter/Anthropic) |

### Placeholder UI ("Coming Soon")

| Tab | Location | Backend Dependency |
|-----|----------|-------------------|
| Pull Requests | RepositoryDetail.tsx:305 | PR service |
| Issues | RepositoryDetail.tsx:313 | Issue service |
| Actions | RepositoryDetail.tsx:320 | CI/CD integration |
| Settings | RepositoryDetail.tsx:329 | Repo settings API |

### Type Safety Issues

**Untyped API returns (`Promise<any>`):**
- `repository.ts:187` - `getBlame()`
- `repository.ts:222` - `executeGraphQuery()` (query/results untyped)
- `repository.ts:230` - `triggerGraphSync()`
- `repository.ts:238` - `getGraphSyncStatus()`

**~15 instances of `catch (err: any)`** across auth, settings, and feature pages.

---

## Blunt Assessment: Mock to Real Implementation

### What "Wiring Up" Actually Means

#### 1. Dashboard (Effort: Medium)
**Current:** Hardcoded stats, fake activity feed
**Required:**
- API endpoint: `GET /api/v1/stats` (aggregate repo count, commit count, PR count)
- API endpoint: `GET /api/v1/activity` (recent commits, PRs, issues across user's repos)
- API endpoint: `GET /api/v1/repos?limit=5&sort=updated` (already exists, just wire it)
- Decision: What AI insights actually come from? This implies an AI service analyzing repos.

**Honest take:** Stats and activity are straightforward. "AI Insights" is hand-wavy - either cut it or define what it actually does.

#### 2. Repositories List (Effort: Low)
**Current:** `mockRepositories` array
**Required:** Replace with `useQuery` calling existing `GET /api/v1/repos`
**Honest take:** This should take 30 minutes. It's already built on the backend.

#### 3. Pull Requests (Effort: High)
**Current:** Fake PR list, fake AI review comments
**Required:**
- Full PR service in API (create, list, review, merge) - **not yet built**
- PR database tables exist but no service layer
- AI review integration requires: embedding PR diff -> LLM analysis -> store comments
- Webhook from git push to trigger PR checks

**Honest take:** This is Sprint 7 work. The UI is built, but the entire backend PR workflow is missing. 2-3 days minimum for basic CRUD, another 2-3 days for AI review integration.

#### 4. Knowledge Graph (Effort: High)
**Current:** Static mock nodes/edges
**Required:**
- FalkorDB running and populated (Sprint 3 work - marked "CURRENT" but not done)
- Graph sync worker that parses repos on push
- `GET /api/v1/repos/:owner/:repo/graph/query` endpoint
- Real-time graph data transformation for Sigma.js

**Honest take:** This is the core differentiator of CV-Hub and it's not built. The mock UI looks pretty but there's no graph database, no sync worker, no query engine. This is weeks of work, not days.

#### 5. Search (Effort: High)
**Current:** Fake search results
**Required:**
- Qdrant running with embeddings
- Embedding generation on code push (same sync worker as graph)
- `POST /api/v1/search` endpoint with vector similarity
- Result ranking and snippet extraction

**Honest take:** Semantic search requires the same infrastructure as Knowledge Graph. You can't have one without the other. Both depend on Sprint 3 completing.

#### 6. AI Assistant (Effort: Medium-High)
**Current:** `generateMockResponse()` with setTimeout
**Required:**
- LLM API integration (OpenRouter, Anthropic, etc.)
- Context retrieval from graph/vector store for RAG
- Streaming response handling
- Conversation persistence

**Honest take:** Basic chat is easy (call LLM API, stream response). Useful chat that understands your codebase requires the graph/vector infrastructure. Without that, it's just ChatGPT with extra steps.

---

## Dependency Graph

```
                    +-------------------+
                    | Sprint 3:         |
                    | FalkorDB + Qdrant |
                    | Graph Sync        |
                    +---------+---------+
                              |
            +-----------------+-----------------+
            v                 v                 v
    +-------------+   +-------------+   +---------------+
    | Knowledge   |   | Semantic    |   | AI Assistant  |
    | Graph UI    |   | Search      |   | (RAG)         |
    +-------------+   +-------------+   +---------------+

    +-------------+
    | Sprint 7:   |
    | PR Service  | <-- Independent, can start now
    +-------------+
```

---

## Recommended Order

### 1. Immediate (Low effort, high impact)
- Wire `Repositories.tsx` to real API (30 min)
- Wire `Dashboard.tsx` stats to real counts (1-2 hours)
- Remove or hide non-functional buttons (1 hour)

### 2. Next Sprint
- Complete Sprint 3 (Graph infrastructure) - this unblocks 3 major features
- OR pivot to Sprint 7 (PRs) if graph can wait

### 3. Don't Do
- Don't add more mock data
- Don't build more UI until backend catches up
- Don't ship "Coming Soon" tabs - either build them or remove them

---

## Bottom Line

**Frontend is 70% built, backend is 40% built.** The gap creates a Potemkin village effect - it looks functional until you click anything.

The critical missing piece is Sprint 3 (graph infrastructure). Without FalkorDB and Qdrant running with a sync worker, Knowledge Graph, Search, and AI Assistant are all impossible. That's 3 of 6 major features blocked on infrastructure that doesn't exist yet.

**Recommendation:** Stop building UI. Finish Sprint 3. Then wire up what exists.

---

## Known Deferred Issues

### Create Repository Page
- **Issue:** "New Repository" button navigates to `/repositories/new` but no route/component exists
- **Complexity:** Repositories can be created under organizations OR users, where a "user" may be a special type of organization
- **Decision:** Deferred until ownership model (user vs org) is clarified

### Test Coverage Gaps
- Components needing tests: `BlameView`, `FileViewer`, `CommitDetail`, `BreadcrumbPath`, `RepositoryLayout`
- Service layer: `repository.ts` has 0% coverage
- Pre-existing failures: 5 tests in `MyFeatureRequests.test.tsx` (API endpoint mismatch)
