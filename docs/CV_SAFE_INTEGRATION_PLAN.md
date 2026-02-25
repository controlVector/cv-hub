# CV-Safe / CV-Hub / CV-Git Integration Plan

## Current State

### What exists and works today

| Component | Status | Notes |
|-----------|--------|-------|
| **cv-hub CLI API** (`/v1`) | Deployed | PAT/JWT/OAuth auth, repos, PRs, issues, releases, branches, commits |
| **cv-hub git HTTP** (`/git`) | Deployed | Clone/push with lazy bare-repo init |
| **cv-hub graph sync worker** | Deployed | Runs `graph-sync.worker.js` in K8s, has FalkorDB + Qdrant |
| **cv-git CVHubAdapter** | Implemented | 632-line adapter, 25+ methods, auto-detects from remote URL |
| **cv-git graph sync engine** | Implemented | Parser -> FalkorDB -> Qdrant, incremental delta sync |
| **cv-safe safety-graph** | Implemented | FalkorDBAdapter wraps cv-git GraphManager, read-only |
| **cv-safe safety-assess** | Implemented | Classification, patterns, mapping, coupling, refactoring |
| **cv-safe CLI** (`cv-safe`) | Implemented | 7 subcommands, connects to local FalkorDB |
| **cv-safe MCP** (`cv-safe-mcp`) | Implemented | 12 tools for Claude Code / Claude Desktop |

### What's missing (the gaps)

```
cv clone/push  ──>  cv-hub git HTTP  ──>  graph sync  ──>  FalkorDB
                                                              |
                                              cv-safe reads graph here
                                              (but can't reach remote FalkorDB)
```

**Gap 1**: cv-hub has no `POST /v1/repos` endpoint (can't create repos from CLI)
**Gap 2**: cv-git graph sync runs locally — no remote sync to cv-hub's FalkorDB
**Gap 3**: cv-safe connects to local FalkorDB only — no way to assess remote repos
**Gap 4**: cv-hub has no safety assessment endpoints or storage
**Gap 5**: No webhook/event to trigger graph re-sync on push

---

## Changes Needed

### Phase 1: Complete CLI-to-Platform Loop

*Goal: `cv clone`, `cv push`, `cv pr create` all work against cv-hub*

#### cv-hub changes

**File: `apps/api/src/routes/cli-api.ts`** — Add missing endpoints:

```
POST /v1/repos                     Create repository
DELETE /v1/repos/:owner/:repo      Delete repository
POST /v1/repos/:owner/:repo/fork   Fork repository
```

The create endpoint needs to accept:
```json
{
  "name": "cv-safe",
  "description": "Safety-critical software architecture assessment",
  "is_private": true,
  "default_branch": "main",
  "org": "controlvector"       // optional — personal repo if omitted
}
```

And map to the existing `createRepository()` service which now properly calls `initBareRepo()`.

#### cv-git changes

**File: `packages/platform/src/adapters/cv-hub.ts`** — Verify/fix:

1. The adapter's `request()` method must handle the flat-array responses from list endpoints (not `{ items, total }` envelopes). **Status: needs verification** — the adapter may already do `response.map(...)` directly.

2. Add `createRepo(options)` to the `GitPlatformAdapter` interface and implement in CVHubAdapter, calling `POST /v1/repos`.

3. Verify `getRepoInfo()` correctly parses cv-hub git remote URLs:
   - `https://api.hub.controlvector.io/git/controlvector/cv-safe.git`
   - `git@controlvector.io:controlvector/cv-safe.git`

**File: `packages/credentials/src/`** — Verify PAT storage works for cv-hub platform type. The `cv-hub-pat` credential already exists in the keychain (confirmed working).

---

### Phase 2: Remote Graph Sync

*Goal: `cv push` triggers graph sync on cv-hub, making FalkorDB data available server-side*

#### cv-hub changes

**File: `apps/api/src/routes/cli-api.ts`** — Add graph sync endpoints:

```
POST /v1/repos/:owner/:repo/sync           Trigger graph sync
GET  /v1/repos/:owner/:repo/sync/status    Get sync status
```

The sync trigger should:
1. Queue a job for the existing graph sync worker
2. Return `202 Accepted` with a job ID
3. Worker uses the same `SyncEngine` logic that cv-git uses locally

**File: `apps/api/src/services/git/sync.service.ts`** — The `processPostReceive()` function already exists and runs after git push. Extend it to also trigger graph sync (currently it only handles webhook notifications).

**Alternative approach** (simpler, no new endpoints):
- Hook into the existing git `post-receive` handler in `apps/api/src/routes/git.ts`
- After a push is received, automatically queue a graph sync job
- cv-safe can then query the graph once sync completes

#### cv-git changes

**File: `packages/cli/src/commands/push.ts`** — After `git push` succeeds:
1. If platform is `cvhub`, call `POST /v1/repos/:owner/:repo/sync` to trigger server-side sync
2. Optionally wait for completion with polling on `/sync/status`

---

### Phase 3: CV-Safe Remote Assessment

*Goal: `cv-safe assess` can analyze repos hosted on cv-hub*

#### cv-safe changes

**File: `packages/safety-graph/src/config.ts`** — Add remote connection mode:
- Currently resolves local FalkorDB connection from cv-git config
- Add ability to connect to cv-hub's FalkorDB through an API proxy OR directly if network-accessible

**File: `packages/safety-graph/src/falkordb-adapter.ts`** — Two approaches:

**Option A: Direct FalkorDB connection** (simpler, requires network access):
```
cv-safe --graph-url redis://falkordb.cv-hub.svc:6379 --graph-name repo_<id>
```
Works in K8s (same cluster) or with port-forward. Not suitable for external users.

**Option B: Graph query proxy API** (more work, works everywhere):

Add to cv-hub CLI API:
```
POST /v1/repos/:owner/:repo/graph/query    Execute Cypher query
```

Add a `CVHubGraphAdapter` to safety-graph that sends Cypher queries over HTTP instead of direct Redis. This is the cleaner long-term approach and keeps FalkorDB internal.

#### cv-hub changes (for Option B)

**File: `apps/api/src/routes/cli-api.ts`** — Add graph query proxy:

```
POST /v1/repos/:owner/:repo/graph/query
Body: { "query": "MATCH (n:Symbol) RETURN n LIMIT 10" }
Response: { "results": [...] }
```

This proxies Cypher queries to the repo's FalkorDB graph. Requires:
- Auth (existing middleware)
- Repo access check (existing `resolveRepo`)
- Read-only query validation (reject MERGE/CREATE/DELETE)
- Rate limiting

---

### Phase 4: Safety Data Storage & Reporting

*Goal: Safety assessments are stored on cv-hub and visible in the web UI*

#### cv-hub changes

**New DB tables** (migration):
```sql
-- Safety classifications per repo
CREATE TABLE safety_classifications (
  id UUID PRIMARY KEY,
  repository_id UUID REFERENCES repositories(id),
  entity_id TEXT NOT NULL,          -- qualified name from graph
  safety_class TEXT NOT NULL,       -- SAFETY_CRITICAL, SAFETY_RELATED, etc.
  asil TEXT,                        -- QM, A, B, C, D
  confidence REAL,
  evidence JSONB,                   -- array of evidence sources
  is_override BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

-- Safety assessment runs
CREATE TABLE safety_assessments (
  id UUID PRIMARY KEY,
  repository_id UUID REFERENCES repositories(id),
  ref TEXT NOT NULL,                 -- branch or commit SHA
  pattern_id TEXT,                   -- selected reference pattern
  conformance_score JSONB,           -- { zone, dependency, interface, overall }
  classification_summary JSONB,      -- counts per class
  coupling_summary JSONB,
  violation_count INTEGER,
  report_url TEXT,                   -- link to generated report
  author_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ
);
```

**New CLI API endpoints:**
```
POST /v1/repos/:owner/:repo/safety/assess       Trigger assessment
GET  /v1/repos/:owner/:repo/safety/assessments   List assessments
GET  /v1/repos/:owner/:repo/safety/assessments/:id  Get assessment detail
GET  /v1/repos/:owner/:repo/safety/classifications  Get current classifications
PUT  /v1/repos/:owner/:repo/safety/classifications/:entity  Override classification
```

#### cv-safe changes

**File: `packages/safety-cli/src/commands/assess.ts`** — Add `--push` flag:
```
cv-safe assess --push    # runs assessment and uploads results to cv-hub
```

**New package: `@cv-safe/safety-hub`** (or add to safety-graph):
- CVHubSafetyClient that calls the safety API endpoints
- Uploads classifications, assessment results, reports
- Downloads existing classifications for incremental assessment

---

### Phase 5: MCP Bridge (Cloud Claude <-> Claude Code)

*Goal: Claude.ai conversation can trigger cv-safe analysis via MCP*

#### Architecture

```
Claude.ai (cloud conversation)
    |
    | MCP over SSE/WebSocket
    v
cv-hub MCP Gateway (apps/api/src/routes/mcp-gateway.ts)
    |
    | routes tool calls to registered MCP servers
    v
cv-safe-mcp (running in K8s as sidecar or standalone pod)
    |
    | graph queries
    v
FalkorDB (in-cluster)
```

#### cv-hub changes

**New route: `apps/api/src/routes/mcp-gateway.ts`** — MCP protocol proxy:
- Accepts MCP tool calls from authenticated clients (OAuth/PAT)
- Routes to registered MCP servers (cv-safe-mcp, cv-git-mcp, etc.)
- Scoped to repository context (user must have repo access)

**K8s deployment: cv-safe-mcp sidecar** — Deploy cv-safe-mcp as a service in the cv-hub namespace:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cv-safe-mcp
spec:
  template:
    spec:
      containers:
      - name: cv-safe-mcp
        image: registry.digitalocean.com/cv-hub-registry/cv-safe-mcp:latest
        env:
        - name: FALKORDB_URL
          value: redis://falkordb:6379
```

#### cv-safe changes

**File: `packages/safety-mcp/src/index.ts`** — Add HTTP transport mode:
- Currently runs as stdio MCP server (for Claude Desktop)
- Add SSE/HTTP transport for running as a network service
- Accept repo context from request headers

---

## Implementation Priority

| Phase | Effort | Value | Priority |
|-------|--------|-------|----------|
| **Phase 1**: Complete CLI loop (`POST /v1/repos`, verify adapter) | Small (1-2 days) | High — unblocks all testing | **Do first** |
| **Phase 2**: Remote graph sync on push | Medium (2-3 days) | High — makes graph data available | **Do second** |
| **Phase 3**: Graph query proxy for cv-safe | Medium (2-3 days) | High — enables remote assessment | **Do third** |
| **Phase 4**: Safety data storage | Large (3-5 days) | Medium — persistent results | Do fourth |
| **Phase 5**: MCP bridge | Large (3-5 days) | Medium — Cloud Claude integration | Do fifth |

---

## Immediate Next Steps

1. **Create cv-safe repo on cv-hub** via existing frontend API
2. **Push cv-safe source** to test the full git workflow
3. **Add `POST /v1/repos`** endpoint to cli-api.ts (Phase 1)
4. **Verify CVHubAdapter** in cv-git handles flat-array responses correctly
5. **Test `cv pr create`** against cv-hub to validate the full PR flow
