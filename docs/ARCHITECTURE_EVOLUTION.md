# CV Platform Architecture Evolution: Context, Agent Parity, and Deployment

**Date:** 2026-03-23
**Author:** John Schmotzer / Claude (Opus 4.6 strategic session)
**Scope:** cv-hub, cv-git, cv-agent
**Status:** Design Spec — ready for implementation

---

## Problem Statement

Three gaps prevent the CV platform from being a true AI-native development environment:

1. **Context is flat, not structured.** CLAUDE.md is a manually maintained markdown file. It's not version-controlled against the graph (FalkorDB) or vectors (Qdrant) that cv-git already maintains. The "Context Manifold" concept — where context is a navigable graph with semantic embeddings — exists as a paper but not as a product feature.

2. **CV-Agent is a task dispatcher, not a pair programmer.** When John uses Claude Code locally, he gets real-time decisions, suggestions, and feedback. When cv-agent dispatches a task, it's fire-and-forget with polling for results. There's no bidirectional thinking stream between the planner (Claude.ai) and the executor (Claude Code).

3. **Deployment is manual and brittle.** CV-Git has token management and deterministic builds, but deploying to DOKS/doctl/k8s still falls back to Claude Code running raw kubectl commands. There's no tagged deployment configuration system — every deploy is bespoke.

These three problems share a root cause: **the platform treats context, execution, and infrastructure as separate concerns, but they're all projections of the same underlying state.**

---

## Part 1: Version-Controlled Context Manifold

### Current State

CLAUDE.md is flat markdown, manually written. Claude Code reads it on task start. No connection to FalkorDB graph or Qdrant vectors. Graph and vectors are "about" the code but not "about" the project context.

### Target State

FalkorDB stores: entities, decisions, relationships, architecture. Qdrant stores: embeddings of every context chunk. CLAUDE.md is auto-generated as a human-readable projection of graph state. Every git commit snapshots the manifold state. Any Claude instance can query the manifold for relevant context.

### 1.1 Context Graph Schema (FalkorDB)

New node types extending cv-git's existing code graph:

```
:Decision       { id, title, rationale, date, status, commit_sha }
:Constraint     { id, description, source, priority }
:Persona        { id, name, role, contact }
:Goal           { id, description, timeframe, status }
:Dependency     { id, name, version, purpose }
:DeployTarget   { id, name, provider, config_ref }
:Architecture   { id, component, description, layer }
```

New edge types:

```
(:Decision)-[:AFFECTS]->(:File|:Symbol|:Architecture)
(:Decision)-[:SUPERSEDES]->(:Decision)
(:Decision)-[:MADE_BY]->(:Persona)
(:Constraint)-[:CONSTRAINS]->(:Architecture|:Goal)
(:Goal)-[:REQUIRES]->(:Goal|:Decision)
(:Architecture)-[:CONTAINS]->(:Symbol|:File)
(:DeployTarget)-[:HOSTS]->(:Architecture)
```

### 1.2 Context Versioning

```sql
CREATE TABLE context_versions (
  id              UUID PRIMARY KEY,
  repo_id         UUID REFERENCES repositories(id),
  git_commit_sha  VARCHAR(40) NOT NULL,
  graph_snapshot  JSONB NOT NULL,
  vector_ids      UUID[] DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

Key insight: **CLAUDE.md becomes an output, not an input.** The graph is the source of truth.

### 1.3 CLAUDE.md Generation

Graph query for all context nodes → template engine → markdown sections:
- Project Overview (from :Goal nodes)
- Architecture (from :Architecture nodes + edges)
- Key Decisions (from :Decision nodes, sorted by date)
- Constraints, Team, Dependencies, Deploy Targets
- Recent Changes (from last N commits + their :Decision links)

### 1.4 New MCP Tools

- `cv_context_query` — natural language against the manifold (vector search → graph expansion)
- `cv_context_add` — add a :Decision, :Constraint, :Goal, etc.
- `cv_context_history` — how context evolved across commits
- `cv_context_diff` — diff context between two refs
- `cv_context_export` — export current manifold as CLAUDE.md

---

## Part 2: Agent Parity — Bidirectional Thinking Stream

### Current State

Claude.ai dispatches task (one-way) → CV-Agent runs → reports results (one-way). No visibility into executor thinking, decisions, or questions mid-task.

### Target State

Claude.ai (planner) ↔ CV-Hub (broker) ↔ Claude Code (executor) with real-time streaming of thinking, decisions, questions, progress.

### 2.1 Task Event Streaming

```sql
CREATE TABLE task_events (
  id          UUID PRIMARY KEY,
  task_id     UUID REFERENCES agent_tasks(id),
  event_type  VARCHAR(32) NOT NULL, -- thinking, decision, question, progress, file_change, error, completed
  content     JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_task_events_task ON task_events(task_id, created_at);
```

### 2.2 New MCP Tools

- `cv_task_stream` — get live event stream from a running task
- `cv_task_respond` — answer a question mid-task
- `cv_task_redirect` — inject new instruction mid-task

### 2.3 Structured Output from Claude Code

Inject into task prompts:

```
[THINKING] <reasoning>
[DECISION] <choice and why>
[QUESTION] <what the planner needs to answer>
[PROGRESS] <completion status>
```

cv-agent executor.ts parses these markers and POSTs as task_events.

---

## Part 3: CV-Deploy — Tagged Deployment Configurations

### Current State

Deployments via Claude Code running kubectl/doctl commands. No standard interface, no config management.

### Target State

Deploy targets are graph nodes with tagged YAML configs. `cv deploy <tag>` runs the right provider adapter.

### 3.1 Deploy Configuration

```yaml
# deploy/hub-production.yaml
target: hub-production
provider: doks
cluster: cv-hub-cluster
namespace: cv-hub
registry: registry.digitalocean.com/controlvector
services:
  api:
    image: cv-hub-api
    dockerfile: apps/api/Dockerfile
    replicas: 2
    health: /health
tokens:
  DIGITALOCEAN_TOKEN: vault://do-token
hooks:
  pre_deploy: scripts/pre-deploy.sh
  rollback: scripts/rollback.sh
```

### 3.2 Commands

```
cv deploy list                    # List targets
cv deploy push hub-production     # Deploy
cv deploy rollback hub-production # Rollback
cv deploy status hub-production   # Health
cv deploy diff hub-production     # Preview changes
```

### 3.3 Provider Adapter Interface

```typescript
interface DeployProvider {
  preflight(config): Promise<PreflightResult>;
  build(config, services): Promise<BuildResult>;
  push(config, builds): Promise<PushResult>;
  deploy(config, images): Promise<DeployResult>;
  healthCheck(config): Promise<HealthResult>;
  rollback(config, toVersion): Promise<RollbackResult>;
}
```

Providers: doks, ssh, fly, docker-compose, cloudflare

---

## Implementation Plan

- Phase 1: Context Manifold (cv-git + cv-hub) — 2-3 days
- Phase 2: Task Event Streaming (cv-hub + cv-agent) — 2-3 days
- Phase 3: CV-Deploy (cv-git) — 3-4 days
- Phase 4: Integration — 1-2 days
