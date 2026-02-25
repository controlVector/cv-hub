/**
 * Context Generation Service
 * Assembles CLAUDE.md content from graph data and repository summaries.
 */

import { db } from '../db';
import { repositorySummaries } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import type { GraphManager } from './graph/graph.service';

interface RepoInfo {
  id: string;
  slug: string;
  defaultBranch: string | null;
}

// ── Shared data fetchers ──────────────────────────────────────────────

async function fetchSummary(repoId: string) {
  return db.query.repositorySummaries.findFirst({
    where: eq(repositorySummaries.repositoryId, repoId),
    orderBy: desc(repositorySummaries.createdAt),
  });
}

async function fetchStats(graph: GraphManager) {
  try {
    return await graph.getStats();
  } catch {
    return { fileCount: 0, symbolCount: 0, commitCount: 0, moduleCount: 0, functionCount: 0, classCount: 0, relationshipCount: 0 };
  }
}

async function fetchTopFiles(graph: GraphManager) {
  try {
    const results = await graph.query(
      `MATCH (f:File)
       WHERE f.complexity > 0
       RETURN f.path AS path, f.linesOfCode AS linesOfCode, f.complexity AS complexity,
              f.summary AS summary, f.language AS language
       ORDER BY f.complexity DESC
       LIMIT 15`
    );
    return results.map((r: any) => ({
      path: r.path || '',
      linesOfCode: r.linesOfCode || 0,
      complexity: r.complexity || 0,
      summary: r.summary || '',
      language: r.language || '',
    }));
  } catch { return []; }
}

async function fetchTopSymbols(graph: GraphManager) {
  try {
    const results = await graph.query(
      `MATCH (s:Symbol)
       WHERE s.complexity > 0
       RETURN s.qualifiedName AS qualifiedName, s.name AS name, s.kind AS kind,
              s.file AS file, s.complexity AS complexity, s.summary AS summary
       ORDER BY s.complexity DESC
       LIMIT 15`
    );
    return results.map((r: any) => ({
      qualifiedName: r.qualifiedName || '',
      name: r.name || '',
      kind: r.kind || '',
      file: r.file || '',
      complexity: r.complexity || 0,
      summary: r.summary || '',
    }));
  } catch { return []; }
}

async function fetchModules(graph: GraphManager) {
  try {
    const results = await graph.query(
      `MATCH (m:Module)-[:CONTAINS]->(f:File)
       WITH m.path AS path, count(f) AS fileCount
       WHERE NOT path CONTAINS '/'
       RETURN path, fileCount
       ORDER BY fileCount DESC
       LIMIT 20`
    );
    return results.map((r: any) => ({
      path: r.path || '',
      fileCount: typeof r.fileCount === 'number' ? r.fileCount : 0,
    }));
  } catch { return []; }
}

async function fetchLanguages(graph: GraphManager) {
  try {
    const results = await graph.query(
      `MATCH (f:File)
       WHERE f.language IS NOT NULL AND f.language <> 'unknown'
       RETURN f.language AS language, count(f) AS count
       ORDER BY count DESC
       LIMIT 10`
    );
    return results.map((r: any) => ({
      language: r.language || '',
      count: typeof r.count === 'number' ? r.count : 0,
    }));
  } catch { return []; }
}

async function fetchRecentCommits(graph: GraphManager) {
  try {
    const results = await graph.query(
      `MATCH (c:Commit)
       WHERE c.message IS NOT NULL
       OPTIONAL MATCH (c)-[:MODIFIES]->(f:File)
       WITH c, collect(f.path)[0..5] AS files
       RETURN c.sha AS sha, c.message AS message, c.author AS author,
              c.timestamp AS timestamp, c.filesChanged AS filesChanged, files
       ORDER BY c.timestamp DESC
       LIMIT 10`
    );
    return results.map((r: any) => ({
      sha: (r.sha || '').slice(0, 8),
      message: (r.message || '').split('\n')[0].slice(0, 80),
      author: r.author || '',
      filesChanged: r.filesChanged || 0,
      files: (r.files || []) as string[],
    }));
  } catch { return []; }
}

async function fetchDependencyMap(graph: GraphManager) {
  try {
    const results = await graph.query(
      `MATCH (a:File)-[:IMPORTS]->(b:File)
       WITH split(a.path, '/')[0] AS fromModule, split(b.path, '/')[0] AS toModule
       WHERE fromModule <> toModule
       RETURN fromModule, toModule, count(*) AS weight
       ORDER BY weight DESC
       LIMIT 20`
    );
    return results.map((r: any) => ({
      from: r.fromModule || '',
      to: r.toModule || '',
      weight: typeof r.weight === 'number' ? r.weight : 0,
    }));
  } catch { return []; }
}

async function fetchDeadCode(graph: GraphManager) {
  try {
    const results = await graph.query(
      `MATCH (s:Symbol)
       WHERE s.kind IN ['function', 'method'] AND s.visibility <> 'private'
       AND NOT EXISTS { MATCH ()-[:CALLS]->(s) }
       AND NOT s.name STARTS WITH '_'
       AND NOT s.name = 'constructor'
       RETURN s.name AS name, s.kind AS kind, s.file AS file, s.complexity AS complexity
       ORDER BY s.complexity DESC
       LIMIT 10`
    );
    return results.map((r: any) => ({
      name: r.name || '',
      kind: r.kind || '',
      file: r.file || '',
      complexity: r.complexity || 0,
    }));
  } catch { return []; }
}

async function fetchComplexityHotspots(graph: GraphManager) {
  try {
    const results = await graph.query(
      `MATCH (f:File)
       WHERE f.complexity > 0 AND f.linesOfCode > 0
       WITH f, f.complexity * 1.0 / f.linesOfCode AS density
       RETURN f.path AS path, f.complexity AS complexity, f.linesOfCode AS linesOfCode,
              round(density * 1000) / 1000.0 AS density
       ORDER BY density DESC
       LIMIT 10`
    );
    return results.map((r: any) => ({
      path: r.path || '',
      complexity: r.complexity || 0,
      linesOfCode: r.linesOfCode || 0,
      density: r.density || 0,
    }));
  } catch { return []; }
}

// ── CLAUDE.md generator ───────────────────────────────────────────────

/**
 * Generate CLAUDE.md content from graph data and repository summaries.
 * Returns the markdown string, or null if no summary data is available.
 */
export async function generateClaudeMd(
  repo: RepoInfo,
  ownerSlug: string,
  repoSlug: string,
  graph: GraphManager
): Promise<string | null> {
  const summary = await fetchSummary(repo.id);
  if (!summary) return null;

  // Fetch all data in parallel
  const [stats, topFiles, topSymbols, modules, languages, recentCommits, deps, deadCode, hotspots] = await Promise.all([
    fetchStats(graph),
    fetchTopFiles(graph),
    fetchTopSymbols(graph),
    fetchModules(graph),
    fetchLanguages(graph),
    fetchRecentCommits(graph),
    fetchDependencyMap(graph),
    fetchDeadCode(graph),
    fetchComplexityHotspots(graph),
  ]);

  const lines: string[] = [];
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

  lines.push('# CLAUDE.md — Auto-generated by CV-Hub');
  lines.push('');
  lines.push('> This file is regenerated on each graph sync. Do not edit manually.');
  lines.push('');

  // Overview
  lines.push('## Overview');
  lines.push(summary.summary);
  lines.push('');

  // Technologies
  const techs = (summary.technologies as string[] | null) || [];
  if (techs.length > 0) {
    lines.push('## Technologies');
    for (const tech of techs) lines.push(`- ${tech}`);
    lines.push('');
  }

  // Entry Points
  const entryPoints = (summary.entryPoints as string[] | null) || [];
  if (entryPoints.length > 0) {
    lines.push('## Entry Points');
    for (const ep of entryPoints) lines.push(`- ${ep}`);
    lines.push('');
  }

  // Architecture Patterns
  const patterns = (summary.keyPatterns as string[] | null) || [];
  if (patterns.length > 0) {
    lines.push('## Architecture Patterns');
    for (const p of patterns) lines.push(`- ${p}`);
    lines.push('');
  }

  // Repository Stats
  lines.push('## Repository Stats');
  lines.push(`- ${stats.fileCount} files, ${stats.symbolCount} symbols, ${stats.commitCount} commits`);
  if (languages.length > 0) {
    lines.push(`- Languages: ${languages.map(l => `${l.language} (${l.count})`).join(', ')}`);
  }
  lines.push('');

  // Key Files
  if (topFiles.length > 0) {
    lines.push('## Key Files (by complexity)');
    lines.push('| File | LOC | Complexity | Summary |');
    lines.push('|------|-----|------------|---------|');
    for (const f of topFiles) {
      lines.push(`| ${f.path} | ${f.linesOfCode} | ${f.complexity} | ${esc(f.summary)} |`);
    }
    lines.push('');
  }

  // Key Symbols
  if (topSymbols.length > 0) {
    lines.push('## Key Symbols (by complexity)');
    lines.push('| Symbol | Kind | File | Complexity | Summary |');
    lines.push('|--------|------|------|------------|---------|');
    for (const s of topSymbols) {
      lines.push(`| ${s.name} | ${s.kind} | ${s.file} | ${s.complexity} | ${esc(s.summary)} |`);
    }
    lines.push('');
  }

  // Directory Structure
  if (modules.length > 0) {
    lines.push('## Directory Structure');
    for (const m of modules) lines.push(`- \`${m.path}/\` — ${m.fileCount} files`);
    lines.push('');
  }

  // Module Dependencies
  if (deps.length > 0) {
    lines.push('## Module Dependencies');
    lines.push('Top cross-module import relationships:');
    lines.push('');
    for (const d of deps) {
      lines.push(`- \`${d.from}/\` → \`${d.to}/\` (${d.weight} imports)`);
    }
    lines.push('');
  }

  // Complexity Hotspots
  if (hotspots.length > 0) {
    lines.push('## Complexity Hotspots');
    lines.push('Files with highest complexity density (complexity / LOC):');
    lines.push('');
    lines.push('| File | Complexity | LOC | Density |');
    lines.push('|------|------------|-----|---------|');
    for (const h of hotspots) {
      lines.push(`| ${h.path} | ${h.complexity} | ${h.linesOfCode} | ${h.density} |`);
    }
    lines.push('');
  }

  // Dead Code Candidates
  if (deadCode.length > 0) {
    lines.push('## Dead Code Candidates');
    lines.push('Public functions/methods with no callers in the graph:');
    lines.push('');
    lines.push('| Symbol | Kind | File | Complexity |');
    lines.push('|--------|------|------|------------|');
    for (const d of deadCode) {
      lines.push(`| ${d.name} | ${d.kind} | ${d.file} | ${d.complexity} |`);
    }
    lines.push('');
  }

  // Recent Changes
  if (recentCommits.length > 0) {
    lines.push('## Recent Changes');
    for (const c of recentCommits) {
      const filesStr = c.files.length > 0 ? ` (${c.files.join(', ')})` : '';
      lines.push(`- \`${c.sha}\` ${esc(c.message)}${filesStr}`);
    }
    lines.push('');
  }

  // MCP Tools hints
  lines.push('## Using CV-Hub MCP Tools');
  lines.push('');
  lines.push('This repository is hosted on CV-Hub with knowledge graph and semantic search.');
  lines.push('Configure MCP access with: `cv auth setup cv-hub`');
  lines.push('');
  lines.push('Useful queries:');
  lines.push('- `search_code` — semantic code search across the repo');
  lines.push('- `get_symbol` — get details, callers, and callees for any function');
  lines.push('- `find_callers` / `find_callees` — trace call chains');
  lines.push('- `query_graph` — run custom Cypher queries against the knowledge graph');
  lines.push('- `complexity_hotspots` — find high-complexity code');
  lines.push('- `find_dead_code` — find unused functions');
  lines.push('- `get_repo_context` — get structured JSON context for this repo');
  lines.push('');

  return lines.join('\n');
}

// ── Structured context (for MCP tools) ────────────────────────────────

export interface StructuredContext {
  summary: string | null;
  technologies: string[];
  entryPoints: string[];
  keyPatterns: string[];
  stats: { fileCount: number; symbolCount: number; commitCount: number; moduleCount: number };
  topFiles: Array<{ path: string; linesOfCode: number; complexity: number; summary: string }>;
  topSymbols: Array<{ name: string; kind: string; file: string; complexity: number; summary: string }>;
  languages: Array<{ language: string; count: number }>;
  modules: Array<{ path: string; fileCount: number }>;
  dependencies: Array<{ from: string; to: string; weight: number }>;
  recentCommits: Array<{ sha: string; message: string; author: string; filesChanged: number; files: string[] }>;
  deadCode: Array<{ name: string; kind: string; file: string; complexity: number }>;
  complexityHotspots: Array<{ path: string; complexity: number; linesOfCode: number; density: number }>;
}

/**
 * Get structured context data (JSON-friendly) for MCP tool responses.
 */
export async function getStructuredContext(
  repo: RepoInfo,
  ownerSlug: string,
  repoSlug: string,
  graph: GraphManager
): Promise<StructuredContext> {
  const summaryRecord = await fetchSummary(repo.id);

  const [stats, topFiles, topSymbols, languages, modules, deps, recentCommits, deadCode, hotspots] = await Promise.all([
    fetchStats(graph),
    fetchTopFiles(graph),
    fetchTopSymbols(graph),
    fetchLanguages(graph),
    fetchModules(graph),
    fetchDependencyMap(graph),
    fetchRecentCommits(graph),
    fetchDeadCode(graph),
    fetchComplexityHotspots(graph),
  ]);

  return {
    summary: summaryRecord?.summary || null,
    technologies: (summaryRecord?.technologies as string[] | null) || [],
    entryPoints: (summaryRecord?.entryPoints as string[] | null) || [],
    keyPatterns: (summaryRecord?.keyPatterns as string[] | null) || [],
    stats: {
      fileCount: stats.fileCount,
      symbolCount: stats.symbolCount,
      commitCount: stats.commitCount,
      moduleCount: stats.moduleCount,
    },
    topFiles: topFiles.map(f => ({ path: f.path, linesOfCode: f.linesOfCode, complexity: f.complexity, summary: f.summary })),
    topSymbols: topSymbols.map(s => ({ name: s.name, kind: s.kind, file: s.file, complexity: s.complexity, summary: s.summary })),
    languages,
    modules,
    dependencies: deps,
    recentCommits,
    deadCode,
    complexityHotspots: hotspots,
  };
}
