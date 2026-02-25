/**
 * Context Engine Adapter
 *
 * Thin gateway between the context engine and CV-Git's graph/vector services.
 * This is the ONLY file in the context engine that imports getGraphManager.
 * All functions here mirror the semantics of existing MCP tools:
 *
 *   getRepoContext()      → get_repo_context MCP tool
 *   queryGraph()          → query_graph MCP tool
 *   findCallers()         → find_callers MCP tool
 *   findCallees()         → find_callees MCP tool
 *   getImpactAnalysis()   → graph /impact route
 *   getFileDependents()   → graph /file route
 *   getFileDependencies() → graph /file route
 */

import { getGraphManager } from './graph/graph.service';
import { getStructuredContext, type StructuredContext } from './context-generation.service';
import type { ContextConcern } from './context-engine.service';

// ── Types returned to the context engine ──────────────────────────────

export interface AdapterCallerResult {
  qualifiedName: string;
  name: string;
  kind: string;
  file: string;
  summary?: string;
}

export interface AdapterFileResult {
  path: string;
  summary?: string;
  complexity?: number;
  linesOfCode?: number;
  language?: string;
}

export interface AdapterCoChangeResult {
  path: string;
  summary?: string;
  complexity?: number;
  coChangeCount: number;
}

export interface AdapterSymbolCoChangeResult {
  qualifiedName: string;
  name: string;
  kind: string;
  file: string;
  coChangeCount: number;
}

export interface AdapterImpactResult {
  callers: Array<{
    qualifiedName: string;
    name: string;
    kind: string;
    file: string;
    complexity?: number;
  }>;
  coChanged: Array<AdapterSymbolCoChangeResult>;
}

// ── Repo-level context (wraps get_repo_context MCP tool) ──────────────

export async function getRepoContext(
  repo: { id: string; slug: string; defaultBranch: string | null },
  ownerSlug: string,
  repoSlug: string,
  concern?: ContextConcern,
): Promise<StructuredContext> {
  const graph = await getGraphManager(repo.id);
  return getStructuredContext(repo, ownerSlug, repoSlug, graph, concern);
}

// ── Raw Cypher query (wraps query_graph MCP tool) ─────────────────────

export async function queryGraph(
  repoId: string,
  cypher: string,
  params?: Record<string, any>,
): Promise<any[]> {
  try {
    const gm = await getGraphManager(repoId);
    return await gm.query(cypher, params);
  } catch {
    return [];
  }
}

// ── Callers (wraps find_callers MCP tool) ─────────────────────────────
// Uses flat RETURN columns instead of gm.getCallers() which returns raw
// compact-format node arrays that don't have named properties.

export async function findCallers(
  repoId: string,
  qualifiedName: string,
): Promise<AdapterCallerResult[]> {
  return queryGraph(
    repoId,
    `MATCH (caller:Symbol)-[:CALLS]->(s:Symbol {qualifiedName: $qualifiedName})
     RETURN caller.qualifiedName AS qualifiedName, caller.name AS name,
            caller.kind AS kind, caller.file AS file, caller.summary AS summary`,
    { qualifiedName },
  ).then(rows => rows.map((r: any) => ({
    qualifiedName: r.qualifiedName || '',
    name: r.name || '',
    kind: r.kind || '',
    file: r.file || '',
    summary: r.summary,
  })));
}

// ── Callees (wraps find_callees MCP tool) ─────────────────────────────

export async function findCallees(
  repoId: string,
  qualifiedName: string,
): Promise<AdapterCallerResult[]> {
  return queryGraph(
    repoId,
    `MATCH (s:Symbol {qualifiedName: $qualifiedName})-[:CALLS]->(callee:Symbol)
     RETURN callee.qualifiedName AS qualifiedName, callee.name AS name,
            callee.kind AS kind, callee.file AS file, callee.summary AS summary`,
    { qualifiedName },
  ).then(rows => rows.map((r: any) => ({
    qualifiedName: r.qualifiedName || '',
    name: r.name || '',
    kind: r.kind || '',
    file: r.file || '',
    summary: r.summary,
  })));
}

// ── Impact analysis (wraps graph /impact route) ───────────────────────

export async function getImpactAnalysis(
  repoId: string,
  qualifiedName: string,
  depth = 2,
): Promise<AdapterImpactResult> {
  try {
    const gm = await getGraphManager(repoId);
    const impact = await gm.getImpactAnalysis(qualifiedName, depth);
    return {
      callers: impact.callers.map((c: any) => ({
        qualifiedName: c.qualifiedName || '',
        name: c.name || '',
        kind: c.kind || '',
        file: c.file || '',
        complexity: c.complexity,
      })),
      coChanged: impact.coChanged.map((c: any) => ({
        qualifiedName: c.qualifiedName || '',
        name: c.name || '',
        kind: c.kind || '',
        file: c.file || '',
        coChangeCount: c.coChangeCount || 0,
      })),
    };
  } catch {
    return { callers: [], coChanged: [] };
  }
}

// ── File dependents (wraps graph /file route) ─────────────────────────

export async function getFileDependents(
  repoId: string,
  filePath: string,
): Promise<AdapterFileResult[]> {
  return queryGraph(
    repoId,
    `MATCH (dependent:File)-[:IMPORTS]->(f:File {path: $filePath})
     RETURN dependent.path AS path, dependent.summary AS summary,
            dependent.complexity AS complexity`,
    { filePath },
  ).then(rows => rows.map((r: any) => ({
    path: r.path || '',
    summary: r.summary,
    complexity: r.complexity,
  })));
}

// ── File dependencies (wraps graph /file route) ───────────────────────

export async function getFileDependencies(
  repoId: string,
  filePath: string,
): Promise<AdapterFileResult[]> {
  return queryGraph(
    repoId,
    `MATCH (f:File {path: $filePath})-[:IMPORTS]->(dep:File)
     RETURN dep.path AS path, dep.summary AS summary,
            dep.complexity AS complexity`,
    { filePath },
  ).then(rows => rows.map((r: any) => ({
    path: r.path || '',
    summary: r.summary,
    complexity: r.complexity,
  })));
}

// ── File co-change partners (via query_graph — no dedicated MCP tool) ─

export async function getFileCoChangePartners(
  repoId: string,
  filePath: string,
  limit = 5,
): Promise<AdapterCoChangeResult[]> {
  const results = await queryGraph(
    repoId,
    `MATCH (c:Commit)-[:MODIFIES]->(f:File {path: $filePath})
     MATCH (c)-[:MODIFIES]->(other:File)
     WHERE other.path <> $filePath
     WITH other, count(c) AS coChangeCount
     WHERE coChangeCount >= 2
     RETURN other.path AS path, other.summary AS summary,
            other.complexity AS complexity, coChangeCount
     ORDER BY coChangeCount DESC
     LIMIT $limit`,
    { filePath, limit },
  );

  return results.map((r: any) => ({
    path: r.path || '',
    summary: r.summary,
    complexity: r.complexity,
    coChangeCount: r.coChangeCount || 0,
  }));
}

// ── Scoped file summaries (via query_graph — concern-filtered) ────────

export async function getScopedFileSummaries(
  repoId: string,
  concernFilter: string,
  limit = 15,
): Promise<AdapterFileResult[]> {
  const results = await queryGraph(
    repoId,
    `MATCH (f:File)
     WHERE f.summary IS NOT NULL AND f.summary <> '' AND ${concernFilter}
     RETURN f.path AS path, f.summary AS summary, f.complexity AS complexity
     ORDER BY f.complexity DESC
     LIMIT $limit`,
    { limit },
  );

  return results.map((r: any) => ({
    path: r.path || '',
    summary: r.summary || '',
    complexity: r.complexity || 0,
  }));
}
