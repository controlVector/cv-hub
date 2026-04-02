# FIX: Task-to-Executor Routing (Affinity-Based Claim)

**Date:** 2026-04-02  
**Author:** Claude (planner) via CV-Hub MCP  
**Priority:** Critical — blocks all repo-scoped task dispatch  
**Affects:** `cv-hub` (API) and `cv-agent` (client)

---

## 1. Problem Statement

When a task is created with a `repositoryId` (i.e., scoped to a specific repo via `owner`/`repo` on `create_task`), **any** executor can claim it — not just the executor whose workspace matches that repo. The first executor to poll wins, regardless of affinity.

### Observed Failure (2026-04-02)

1. Planner (Claude.ai via MCP) dispatches task with `owner=schmotz`, `repo=tastytrade-mcp`
2. MCP `create_task` resolves this to `repositoryId = bd496d92-...` and inserts the task as `pending`
3. **NyxCore** executor (`a7c4458f`, workspace `/home/schmotz/nyxIndustries/github/nyxCore`) polls first
4. `claimNextTask()` returns the tastytrade task — no affinity check
5. NyxCore starts Claude Code in the **wrong workspace** → immediate `exit code 1`
6. Second attempt: **NyxForge** executor grabs it → same failure

The tastytrade-mcp executor (`b8e03100`, workspace `/home/schmotz/project/tastytrade-mcp`) never got the task.

### Root Cause

`claimNextTask()` in `apps/api/src/services/agent-task.service.ts` lines ~100-120:

```typescript
export async function claimNextTask(
  executorId: string,
  userId: string,
): Promise<AgentTask | null> {
  const task = await db.query.agentTasks.findFirst({
    where: and(
      eq(agentTasks.userId, userId),
      eq(agentTasks.status, 'pending'),
      isNull(agentTasks.executorId),
    ),
    orderBy: [desc(agentTasks.priority), desc(agentTasks.createdAt)],
  });
  // ... assigns to whoever called
}
```

**Zero awareness** of:
- `task.repositoryId` (which repo the task targets)
- `executor.repositoryId` (which repo the executor is bound to)
- `executor.workspaceRoot` (which directory the executor operates in)

---

## 2. Fix: CV-Hub API (`agent-task.service.ts`)

### 2.1 New `claimNextTask` with Affinity Matching

Replace the current greedy claim with a two-pass affinity system:

```typescript
export async function claimNextTask(
  executorId: string,
  userId: string,
): Promise<AgentTask | null> {
  // 1. Look up the calling executor to know its affinity
  const executor = await db.query.agentExecutors.findFirst({
    where: and(
      eq(agentExecutors.id, executorId),
      eq(agentExecutors.userId, userId),
    ),
  });
  if (!executor) return null;

  // 2. PASS 1 — Strong affinity: tasks whose repositoryId matches this executor
  //    Only attempt if the executor HAS a repositoryId
  if (executor.repositoryId) {
    const affinityTask = await db.query.agentTasks.findFirst({
      where: and(
        eq(agentTasks.userId, userId),
        eq(agentTasks.status, 'pending'),
        isNull(agentTasks.executorId),
        eq(agentTasks.repositoryId, executor.repositoryId),
      ),
      orderBy: [desc(agentTasks.priority), desc(agentTasks.createdAt)],
    });

    if (affinityTask) {
      const [claimed] = await db
        .update(agentTasks)
        .set({ executorId, status: 'assigned', updatedAt: new Date() })
        .where(
          and(
            eq(agentTasks.id, affinityTask.id),
            eq(agentTasks.status, 'pending'),
            isNull(agentTasks.executorId),
          ),
        )
        .returning();
      if (claimed) return claimed;
    }
  }

  // 3. PASS 2 — Unscoped tasks: tasks with NO repositoryId (any executor can claim)
  const unscopedTask = await db.query.agentTasks.findFirst({
    where: and(
      eq(agentTasks.userId, userId),
      eq(agentTasks.status, 'pending'),
      isNull(agentTasks.executorId),
      isNull(agentTasks.repositoryId),
    ),
    orderBy: [desc(agentTasks.priority), desc(agentTasks.createdAt)],
  });

  if (unscopedTask) {
    const [claimed] = await db
      .update(agentTasks)
      .set({ executorId, status: 'assigned', updatedAt: new Date() })
      .where(
        and(
          eq(agentTasks.id, unscopedTask.id),
          eq(agentTasks.status, 'pending'),
          isNull(agentTasks.executorId),
        ),
      )
      .returning();
    if (claimed) return claimed;
  }

  // 4. PASS 3 — Stale rescue: repo-scoped tasks pending > 60s with no matching executor
  //    Prevents tasks from being stuck forever if the right executor is offline
  const STALE_THRESHOLD_MS = 60_000;
  const staleTask = await db.query.agentTasks.findFirst({
    where: and(
      eq(agentTasks.userId, userId),
      eq(agentTasks.status, 'pending'),
      isNull(agentTasks.executorId),
      // has a repositoryId (otherwise Pass 2 would have caught it)
      // and was created more than 60s ago
    ),
    orderBy: [desc(agentTasks.priority), desc(agentTasks.createdAt)],
  });

  if (staleTask && staleTask.createdAt.getTime() < Date.now() - STALE_THRESHOLD_MS) {
    const [claimed] = await db
      .update(agentTasks)
      .set({ executorId, status: 'assigned', updatedAt: new Date() })
      .where(
        and(
          eq(agentTasks.id, staleTask.id),
          eq(agentTasks.status, 'pending'),
          isNull(agentTasks.executorId),
        ),
      )
      .returning();
    if (claimed) return claimed;
  }

  return null;
}
```

### 2.2 Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Repo-scoped tasks only go to repo-matched executors** | Prevents wrong-workspace failures we observed |
| **Unscoped tasks (no `repositoryId`) go to any executor** | Backward-compatible with tasks created without `owner`/`repo` |
| **Stale rescue after 60s** | If the right executor is offline, don't leave tasks stuck forever — let any available executor try |
| **Executor lookup on every poll** | Minimal overhead (1 extra query), but gives the claim logic full context about the executor |

### 2.3 Workspace-Path Fallback (Optional Enhancement)

Many executors register with `repositoryId: null` even though they ARE workspace-bound (e.g., `cva:tastytrade-mcp` has `workspaceRoot: /home/schmotz/project/tastytrade-mcp` but `repositoryId: null`).

**After the core fix**, consider adding a soft workspace-path match as an intermediate pass:

```typescript
// Between Pass 1 and Pass 2:
// If executor has no repositoryId but has a workspaceRoot, 
// check if any pending task's repo slug appears in the workspace path
if (!executor.repositoryId && executor.workspaceRoot) {
  const repoScopedTasks = await db.query.agentTasks.findMany({
    where: and(
      eq(agentTasks.userId, userId),
      eq(agentTasks.status, 'pending'),
      isNull(agentTasks.executorId),
      // has repositoryId
    ),
    orderBy: [desc(agentTasks.priority), desc(agentTasks.createdAt)],
    limit: 10,
  });

  for (const task of repoScopedTasks) {
    if (task.repositoryId) {
      const repo = await getRepositoryById(task.repositoryId);
      if (repo && executor.workspaceRoot.includes(repo.slug)) {
        // Soft match — workspace path contains repo slug
        const [claimed] = await db.update(agentTasks)...
        if (claimed) return claimed;
      }
    }
  }
}
```

This is a weaker heuristic but would have caught the tastytrade case. Consider this a v1.1 follow-up.

---

## 3. Fix: CV-Agent (`src/commands/agent.ts`)

### 3.1 Auto-Detect Repository on Registration

Currently `registerExecutor()` sends `workspace_root` but does **not** try to resolve a `repository_id` from the CV-Hub API. This means executors started with `cva agent` in a repo directory still register with `repositoryId: null`.

**Fix in `runAgent()` before calling `registerExecutor()`:**

```typescript
// In runAgent(), after determining workingDir:

// Attempt to resolve repository_id from working directory
let repositoryId: string | undefined;
try {
  // Check if the working dir is a CV-Hub repo by looking at git remote
  const remoteUrl = execSync('git remote get-url origin 2>/dev/null', {
    cwd: workingDir,
    encoding: 'utf8',
    timeout: 5000,
  }).trim();

  // Parse CV-Hub remote URL patterns:
  //   https://git.hub.controlvector.io/owner/repo.git
  //   git@git.hub.controlvector.io:owner/repo.git
  const cvHubMatch = remoteUrl.match(
    /git\.hub\.controlvector\.io[:/]([^/]+)\/([^/.]+)/
  );

  if (cvHubMatch) {
    const [, owner, repo] = cvHubMatch;
    // Call CV-Hub API to resolve owner/repo → repository UUID
    const repoData = await resolveRepoId(creds, owner, repo);
    if (repoData?.id) {
      repositoryId = repoData.id;
      console.log(chalk.gray(`   Repo:     ${owner}/${repo} (${repositoryId.slice(0, 8)})`));
    }
  }
} catch {
  // Not a git repo or no CV-Hub remote — that's fine, register without repo binding
}

// Pass repositoryId to registerExecutor
const executor = await withRetry(
  () => registerExecutor(creds, machineName, workingDir, repositoryId),
  'Executor registration',
);
```

### 3.2 Update `registerExecutor()` in `utils/api.ts`

Add `repositoryId` parameter:

```typescript
export async function registerExecutor(
  creds: CVHubCredentials,
  machineName: string,
  workspaceRoot: string,
  repositoryId?: string,
) {
  const body: Record<string, unknown> = {
    name: `cva:${path.basename(workspaceRoot)}`,
    machine_name: machineName,
    type: 'claude_code',
    workspace_root: workspaceRoot,
    capabilities: {
      tools: ['bash', 'read', 'write', 'edit', 'glob', 'grep'],
      maxConcurrentTasks: 1,
    },
  };
  if (repositoryId) {
    body.repository_id = repositoryId;
  }
  // ... existing fetch call
}
```

### 3.3 Add `resolveRepoId()` API Helper

```typescript
export async function resolveRepoId(
  creds: CVHubCredentials,
  owner: string,
  repo: string,
): Promise<{ id: string; slug: string } | null> {
  const res = await fetch(
    `${creds.CV_HUB_API}/api/v1/repos/${owner}/${repo}`,
    { headers: authHeaders(creds) },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.repository ? { id: data.repository.id, slug: data.repository.slug } : null;
}
```

---

## 4. Testing Checklist

- [ ] **Affinity match**: Create task with `owner=schmotz, repo=tastytrade-mcp`. Verify only the `tastytrade-mcp` executor claims it, not NyxCore/NyxForge.
- [ ] **Unscoped task**: Create task with no `owner`/`repo`. Verify any executor can claim it.
- [ ] **Stale rescue**: Create repo-scoped task when the matching executor is offline. Verify another executor picks it up after 60s.
- [ ] **Concurrent polling**: Multiple executors poll simultaneously. Verify atomicity (no double-claim).
- [ ] **Registration auto-detect**: Start `cva agent` in a CV-Hub repo directory. Verify `repository_id` appears in executor record.
- [ ] **No-repo registration**: Start `cva agent` in a non-git directory. Verify registration succeeds with `repository_id: null`.

## 5. Files to Modify

### CV-Hub API
| File | Change |
|------|--------|
| `apps/api/src/services/agent-task.service.ts` | Rewrite `claimNextTask()` with 3-pass affinity logic |
| `apps/api/src/routes/executors.ts` | No changes needed (passes executorId/userId correctly already) |
| `apps/api/src/routes/executors.test.ts` | Add affinity routing test cases |

### CV-Agent
| File | Change |
|------|--------|
| `src/commands/agent.ts` | Add repo auto-detect before registration |
| `src/utils/api.ts` | Add `repositoryId` param to `registerExecutor()`, add `resolveRepoId()` helper |

---

## 6. Migration Notes

- **No schema changes required** — `agentTasks.repositoryId` and `agentExecutors.repositoryId` columns already exist
- **Backward compatible** — executors without `repositoryId` still claim unscoped tasks normally
- **Existing executors** — currently running `cva agent` sessions will continue working but should be restarted after the cv-agent update to gain repo auto-detect
- **Re-registration safe** — `registerExecutor` is idempotent by machine name; restarting agents will update their `repositoryId`

## 7. Prompt for Claude Code Session

Use the following prompt to dispatch this fix to the cv-hub executor:

```
## Task: Implement affinity-based task routing in claimNextTask()

Read FIX-TASK-ROUTING.md in the repo root for the full specification.

### Summary
The `claimNextTask()` function in `apps/api/src/services/agent-task.service.ts` 
currently does a greedy first-come-first-served claim with no awareness of 
repository affinity. This causes repo-scoped tasks to be claimed by the wrong 
executor.

### What to do
1. Read FIX-TASK-ROUTING.md thoroughly
2. Rewrite `claimNextTask()` with the 3-pass affinity logic described in Section 2.1
3. Add the executor lookup (query agentExecutors by id+userId) at the top
4. Ensure the atomic UPDATE ... WHERE pattern is preserved for each pass
5. Add test cases in executors.test.ts covering:
   - Affinity match (repo-scoped task → matching executor)
   - Unscoped pass-through (no-repo task → any executor)  
   - Non-match skip (repo-scoped task → non-matching executor should NOT claim)
   - Stale rescue (old repo-scoped task → any executor after 60s)
6. Do NOT modify the executor registration route or cv-agent (that's a separate task)

### Constraints
- Do not break existing tests
- Keep the atomic claim pattern (UPDATE WHERE status='pending' AND executorId IS NULL)
- Import `agentExecutors` from schema if not already imported
- The stale threshold should be configurable via constant (default 60_000ms)
```
