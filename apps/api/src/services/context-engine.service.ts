/**
 * Context Engine Service
 * Provides knowledge-graph-driven context injection for Claude Code sessions.
 * Detects compaction, scores context by relevance, and manages session state.
 */

import { db } from '../db';
import { contextEngineSessions, repositorySummaries } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { GraphManager } from './graph/graph.service';

// ── Types ──────────────────────────────────────────────────────────────

export type ContextConcern = 'codebase' | 'deployment' | 'compilation' | 'business';

export interface ActivitySignal {
  session_id: string;
  files_touched: string[];
  symbols_referenced: string[];
  turn_count: number;
  estimated_tokens: number;
  concern?: ContextConcern;
}

export interface RankedContextItem {
  type: 'file' | 'symbol' | 'summary' | 'commit';
  source: 'graph' | 'vector' | 'summary';
  relevanceScore: number;
  content: string;
  metadata: Record<string, unknown>;
}

export interface ContextResult {
  markdown: string;
  token_estimate: number;
  compaction_detected: boolean;
}

// ── Concern weights (v1: no vectors) ──────────────────────────────────

const CONCERN_WEIGHTS_V1: Record<ContextConcern, { structural: number; recency: number; concern_match: number }> = {
  codebase:    { structural: 0.55, recency: 0.30, concern_match: 0.15 },
  deployment:  { structural: 0.30, recency: 0.25, concern_match: 0.45 },
  compilation: { structural: 0.40, recency: 0.15, concern_match: 0.45 },
  business:    { structural: 0.45, recency: 0.15, concern_match: 0.40 },
};

// ── Concern path patterns ─────────────────────────────────────────────

const CONCERN_PATTERNS: Record<ContextConcern, RegExp> = {
  deployment:  /(?:Dockerfile|docker-compose|k8s|helm|deploy|infra|\.ya?ml|\.env)/i,
  compilation: /(?:package\.json|tsconfig|webpack|vite|esbuild|Makefile|build)/i,
  business:    /(?:route|controller|model|service|pricing|billing|safe|board)/i,
  codebase:    /./,  // matches everything (fallback)
};

const CONCERN_CYPHER_FILTERS: Record<ContextConcern, string> = {
  deployment:  `f.path =~ '.*(Dockerfile|docker-compose|k8s|helm|deploy|infra|\\\\.ya?ml|\\\\.env).*'`,
  compilation: `f.path =~ '.*(package\\\\.json|tsconfig|webpack|vite|esbuild|Makefile|build).*'`,
  business:    `f.path =~ '.*(route|controller|model|service|pricing|billing|safe|board).*'`,
  codebase:    'true',
};

// ── Session state helpers ─────────────────────────────────────────────

async function getOrCreateSession(
  sessionId: string,
  repoId: string,
  userId: string,
  executorId?: string,
  concern: ContextConcern = 'codebase',
) {
  const existing = await db.query.contextEngineSessions.findFirst({
    where: and(
      eq(contextEngineSessions.sessionId, sessionId),
      eq(contextEngineSessions.repositoryId, repoId),
    ),
  });

  if (existing) return existing;

  const [created] = await db
    .insert(contextEngineSessions)
    .values({
      sessionId,
      repositoryId: repoId,
      userId,
      executorId: executorId ?? null,
      activeConcern: concern,
    })
    .returning();

  return created;
}

async function updateSession(
  id: string,
  updates: {
    lastTurnCount?: number;
    lastTokenEst?: number;
    injectedFiles?: string[];
    injectedSymbols?: string[];
    activeConcern?: string;
    checkpointSummary?: string | null;
    checkpointFiles?: string[] | null;
    checkpointSymbols?: string[] | null;
  },
) {
  await db
    .update(contextEngineSessions)
    .set({ ...updates, lastActivityAt: new Date() })
    .where(eq(contextEngineSessions.id, id));
}

// ── Concern detection ─────────────────────────────────────────────────

function detectConcern(filesTouched: string[]): ContextConcern | null {
  if (filesTouched.length === 0) return null;

  const counts: Record<ContextConcern, number> = {
    deployment: 0,
    compilation: 0,
    business: 0,
    codebase: 0,
  };

  for (const file of filesTouched) {
    for (const [concern, pattern] of Object.entries(CONCERN_PATTERNS) as [ContextConcern, RegExp][]) {
      if (concern === 'codebase') continue; // skip fallback
      if (pattern.test(file)) {
        counts[concern]++;
      }
    }
  }

  // Check if any non-default concern covers >60% of touched files
  const threshold = filesTouched.length * 0.6;
  let best: ContextConcern | null = null;
  let bestCount = 0;
  for (const [concern, count] of Object.entries(counts) as [ContextConcern, number][]) {
    if (concern === 'codebase') continue;
    if (count > bestCount && count >= threshold) {
      best = concern;
      bestCount = count;
    }
  }

  return best;
}

// ── Scoring helpers ───────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function computeScore(
  item: {
    structuralRelevance: number; // 0-1
    recencyScore: number;        // 0-1
    concernMatch: number;        // 0-1
  },
  concern: ContextConcern,
): number {
  const w = CONCERN_WEIGHTS_V1[concern];
  return (
    w.structural * item.structuralRelevance +
    w.recency * item.recencyScore +
    w.concern_match * item.concernMatch
  );
}

function matchesConcern(path: string, concern: ContextConcern): boolean {
  if (concern === 'codebase') return true;
  return CONCERN_PATTERNS[concern].test(path);
}

// ── Graph expansion helpers ───────────────────────────────────────────

async function expandFilesFromGraph(
  graph: GraphManager,
  filesTouched: string[],
  concern: ContextConcern,
  limit: number,
): Promise<RankedContextItem[]> {
  if (filesTouched.length === 0) return [];

  const items: RankedContextItem[] = [];
  const seen = new Set(filesTouched);

  for (const filePath of filesTouched.slice(0, 10)) {
    // Get co-change partners
    try {
      const coChanged = await graph.query(
        `MATCH (c:Commit)-[:MODIFIES]->(f:File {path: $filePath})
         MATCH (c)-[:MODIFIES]->(other:File)
         WHERE other.path <> $filePath
         WITH other, count(c) AS coChangeCount
         WHERE coChangeCount >= 2
         RETURN other.path AS path, other.summary AS summary,
                other.complexity AS complexity, coChangeCount
         ORDER BY coChangeCount DESC
         LIMIT 5`,
        { filePath },
      );

      for (const r of coChanged) {
        if (seen.has(r.path)) continue;
        seen.add(r.path);
        const concernMatch = matchesConcern(r.path, concern) ? 1.0 : 0.0;
        const structural = Math.min(1.0, (r.coChangeCount || 1) / 10);
        const recency = 0.5; // default for co-change (no timestamp available inline)
        items.push({
          type: 'file',
          source: 'graph',
          relevanceScore: computeScore({ structuralRelevance: structural, recencyScore: recency, concernMatch }, concern),
          content: r.summary ? `**${r.path}** — ${r.summary}` : `**${r.path}** (co-changed ${r.coChangeCount}x)`,
          metadata: { path: r.path, coChangeCount: r.coChangeCount, complexity: r.complexity },
        });
      }
    } catch { /* graph query failed, skip */ }

    // Get import neighbors
    try {
      const imports = await graph.query(
        `MATCH (f:File {path: $filePath})-[:IMPORTS]-(other:File)
         RETURN other.path AS path, other.summary AS summary, other.complexity AS complexity
         LIMIT 5`,
        { filePath },
      );

      for (const r of imports) {
        if (seen.has(r.path)) continue;
        seen.add(r.path);
        const concernMatch = matchesConcern(r.path, concern) ? 1.0 : 0.0;
        items.push({
          type: 'file',
          source: 'graph',
          relevanceScore: computeScore({ structuralRelevance: 0.6, recencyScore: 0.3, concernMatch }, concern),
          content: r.summary ? `**${r.path}** — ${r.summary}` : `**${r.path}** (import neighbor)`,
          metadata: { path: r.path, complexity: r.complexity },
        });
      }
    } catch { /* skip */ }
  }

  // Sort by score and limit
  items.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return items.slice(0, limit);
}

async function expandSymbolsFromGraph(
  graph: GraphManager,
  symbolsReferenced: string[],
  concern: ContextConcern,
  limit: number,
): Promise<RankedContextItem[]> {
  if (symbolsReferenced.length === 0) return [];

  const items: RankedContextItem[] = [];
  const seen = new Set(symbolsReferenced);

  for (const symbolName of symbolsReferenced.slice(0, 10)) {
    // Get callers
    try {
      const callers = await graph.query(
        `MATCH (caller:Symbol)-[:CALLS]->(s:Symbol)
         WHERE s.qualifiedName = $symbolName OR s.name = $symbolName
         RETURN caller.qualifiedName AS qualifiedName, caller.name AS name,
                caller.kind AS kind, caller.file AS file, caller.summary AS summary
         LIMIT 5`,
        { symbolName },
      );

      for (const r of callers) {
        if (seen.has(r.qualifiedName)) continue;
        seen.add(r.qualifiedName);
        const concernMatch = r.file ? (matchesConcern(r.file, concern) ? 1.0 : 0.0) : 0.0;
        items.push({
          type: 'symbol',
          source: 'graph',
          relevanceScore: computeScore({ structuralRelevance: 0.7, recencyScore: 0.3, concernMatch }, concern),
          content: r.summary
            ? `**${r.name}** (${r.kind} in ${r.file}) — ${r.summary}`
            : `**${r.name}** (${r.kind} in ${r.file}) — calls ${symbolName}`,
          metadata: { qualifiedName: r.qualifiedName, kind: r.kind, file: r.file },
        });
      }
    } catch { /* skip */ }

    // Get callees
    try {
      const callees = await graph.query(
        `MATCH (s:Symbol)-[:CALLS]->(callee:Symbol)
         WHERE s.qualifiedName = $symbolName OR s.name = $symbolName
         RETURN callee.qualifiedName AS qualifiedName, callee.name AS name,
                callee.kind AS kind, callee.file AS file, callee.summary AS summary
         LIMIT 5`,
        { symbolName },
      );

      for (const r of callees) {
        if (seen.has(r.qualifiedName)) continue;
        seen.add(r.qualifiedName);
        const concernMatch = r.file ? (matchesConcern(r.file, concern) ? 1.0 : 0.0) : 0.0;
        items.push({
          type: 'symbol',
          source: 'graph',
          relevanceScore: computeScore({ structuralRelevance: 0.6, recencyScore: 0.3, concernMatch }, concern),
          content: r.summary
            ? `**${r.name}** (${r.kind} in ${r.file}) — ${r.summary}`
            : `**${r.name}** (${r.kind} in ${r.file}) — called by ${symbolName}`,
          metadata: { qualifiedName: r.qualifiedName, kind: r.kind, file: r.file },
        });
      }
    } catch { /* skip */ }
  }

  items.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return items.slice(0, limit);
}

async function fetchScopedSummary(
  graph: GraphManager,
  concern: ContextConcern,
  limit: number,
): Promise<RankedContextItem[]> {
  const filter = CONCERN_CYPHER_FILTERS[concern];
  try {
    const results = await graph.query(
      `MATCH (f:File)
       WHERE f.summary IS NOT NULL AND f.summary <> '' AND ${filter}
       RETURN f.path AS path, f.summary AS summary, f.complexity AS complexity
       ORDER BY f.complexity DESC
       LIMIT $limit`,
      { limit },
    );

    return results.map((r: any) => ({
      type: 'file' as const,
      source: 'graph' as const,
      relevanceScore: computeScore(
        { structuralRelevance: 0.4, recencyScore: 0.2, concernMatch: 1.0 },
        concern,
      ),
      content: `**${r.path}** — ${r.summary}`,
      metadata: { path: r.path, complexity: r.complexity },
    }));
  } catch {
    return [];
  }
}

// ── Format helpers ────────────────────────────────────────────────────

function formatContextMarkdown(
  items: RankedContextItem[],
  header: string,
  compactionDetected: boolean,
): string {
  if (items.length === 0) return '';

  const lines: string[] = [];

  if (compactionDetected) {
    lines.push('> **Context Recovery** — Compaction detected. Restoring relevant context from the knowledge graph.\n');
  }

  lines.push(`## ${header}\n`);

  // Group by type
  const fileItems = items.filter(i => i.type === 'file');
  const symbolItems = items.filter(i => i.type === 'symbol');
  const summaryItems = items.filter(i => i.type === 'summary');

  if (fileItems.length > 0) {
    lines.push('### Related Files');
    for (const item of fileItems) {
      lines.push(`- ${item.content}`);
    }
    lines.push('');
  }

  if (symbolItems.length > 0) {
    lines.push('### Related Symbols');
    for (const item of symbolItems) {
      lines.push(`- ${item.content}`);
    }
    lines.push('');
  }

  if (summaryItems.length > 0) {
    lines.push('### Summaries');
    for (const item of summaryItems) {
      lines.push(`- ${item.content}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Initialize session context. Called at session start.
 * Returns a focused context markdown based on repo summary + concern.
 */
export async function initSessionContext(
  repoId: string,
  ownerSlug: string,
  repoSlug: string,
  graph: GraphManager,
  options: {
    session_id: string;
    user_id: string;
    executor_id?: string;
    concern?: ContextConcern;
    max_tokens?: number;
  },
): Promise<ContextResult> {
  const concern = options.concern || 'codebase';
  const maxTokens = options.max_tokens || 4000;

  // Create/get session
  const session = await getOrCreateSession(
    options.session_id,
    repoId,
    options.user_id,
    options.executor_id,
    concern,
  );

  // Fetch repo summary
  const summary = await db.query.repositorySummaries.findFirst({
    where: eq(repositorySummaries.repositoryId, repoId),
    orderBy: desc(repositorySummaries.createdAt),
  });

  // Fetch concern-scoped files from graph
  const scopedItems = await fetchScopedSummary(graph, concern, 15);

  // Build markdown
  const lines: string[] = [];
  lines.push(`# Context Engine — ${ownerSlug}/${repoSlug}\n`);

  if (summary) {
    lines.push('## Repository Overview');
    lines.push(summary.summary);
    lines.push('');

    const techs = (summary.technologies as string[] | null) || [];
    if (techs.length > 0) {
      lines.push(`**Technologies:** ${techs.join(', ')}`);
      lines.push('');
    }

    const patterns = (summary.keyPatterns as string[] | null) || [];
    if (patterns.length > 0) {
      lines.push('**Architecture:**');
      for (const p of patterns) lines.push(`- ${p}`);
      lines.push('');
    }
  }

  if (scopedItems.length > 0) {
    const header = concern === 'codebase' ? 'Key Files' : `Key Files (${concern})`;
    lines.push(`## ${header}`);
    for (const item of scopedItems) {
      lines.push(`- ${item.content}`);
    }
    lines.push('');
  }

  let markdown = lines.join('\n');

  // Trim to budget
  while (estimateTokens(markdown) > maxTokens && scopedItems.length > 0) {
    scopedItems.pop();
    const trimmedLines = lines.slice(0, -scopedItems.length - 1);
    markdown = trimmedLines.join('\n');
  }

  // Track what we injected
  const injectedFiles = scopedItems
    .filter(i => i.metadata.path)
    .map(i => i.metadata.path as string);

  await updateSession(session.id, {
    injectedFiles,
    injectedSymbols: [],
    activeConcern: concern,
    lastTokenEst: 0,
    lastTurnCount: 0,
  });

  return {
    markdown,
    token_estimate: estimateTokens(markdown),
    compaction_detected: false,
  };
}

/**
 * Generate turn-by-turn context injection.
 * Detects compaction, expands graph context, scores, deduplicates, and budget-fits.
 */
export async function generateTurnContext(
  repoId: string,
  graph: GraphManager,
  signal: ActivitySignal,
): Promise<ContextResult> {
  // Load or create session
  const session = await db.query.contextEngineSessions.findFirst({
    where: and(
      eq(contextEngineSessions.sessionId, signal.session_id),
      eq(contextEngineSessions.repositoryId, repoId),
    ),
  });

  if (!session) {
    // Session not initialized — return empty
    return { markdown: '', token_estimate: 0, compaction_detected: false };
  }

  // Detect compaction: token estimate dropped by >50%
  const compactionDetected =
    session.lastTokenEst > 0 &&
    signal.estimated_tokens > 0 &&
    signal.estimated_tokens < session.lastTokenEst * 0.5;

  // Detect concern override
  let activeConcern = session.activeConcern as ContextConcern;
  const detectedConcern = detectConcern(signal.files_touched);
  if (detectedConcern && detectedConcern !== activeConcern) {
    // For simplicity in v1, apply the detected concern immediately for scoring
    // (The plan says track 3+ turns before persisting, but we use it for weights now)
    activeConcern = detectedConcern;
  }

  // Token budget
  const tokenBudget = compactionDetected ? 3000 : 800;

  // Gather context items
  const allItems: RankedContextItem[] = [];

  // If compaction detected and we have checkpoint data, prioritize recovery
  if (compactionDetected && session.checkpointSummary) {
    allItems.push({
      type: 'summary',
      source: 'summary',
      relevanceScore: 1.0, // highest priority for recovery
      content: session.checkpointSummary,
      metadata: { source: 'checkpoint' },
    });
  }

  // Graph expansion for touched files
  const existingFiles = new Set(session.injectedFiles || []);
  const existingSymbols = new Set(session.injectedSymbols || []);

  const [fileItems, symbolItems] = await Promise.all([
    expandFilesFromGraph(graph, signal.files_touched, activeConcern, compactionDetected ? 15 : 8),
    expandSymbolsFromGraph(graph, signal.symbols_referenced, activeConcern, compactionDetected ? 10 : 5),
  ]);

  // Deduplicate against already-injected
  for (const item of fileItems) {
    const path = item.metadata.path as string;
    if (!existingFiles.has(path)) {
      allItems.push(item);
    }
  }

  for (const item of symbolItems) {
    const qn = item.metadata.qualifiedName as string;
    if (!existingSymbols.has(qn)) {
      allItems.push(item);
    }
  }

  // If compaction detected, also re-inject checkpoint files that aren't in signal
  if (compactionDetected && session.checkpointFiles) {
    const checkpointFiles = session.checkpointFiles.filter(f => !signal.files_touched.includes(f));
    if (checkpointFiles.length > 0) {
      const recoveryItems = await expandFilesFromGraph(graph, checkpointFiles, activeConcern, 10);
      for (const item of recoveryItems) {
        allItems.push(item);
      }
    }
  }

  // Sort by relevance score
  allItems.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Budget-fit: select items within token limit
  const selected: RankedContextItem[] = [];
  let tokenCount = 0;
  for (const item of allItems) {
    const itemTokens = estimateTokens(item.content);
    if (tokenCount + itemTokens > tokenBudget) continue;
    selected.push(item);
    tokenCount += itemTokens;
  }

  // If nothing new to inject, return empty
  if (selected.length === 0) {
    await updateSession(session.id, {
      lastTurnCount: signal.turn_count,
      lastTokenEst: signal.estimated_tokens,
    });
    return { markdown: '', token_estimate: 0, compaction_detected: compactionDetected };
  }

  // Format markdown
  const header = compactionDetected ? 'Context Recovery' : 'Relevant Context';
  const markdown = formatContextMarkdown(selected, header, compactionDetected);

  // Update session state
  const newInjectedFiles = [
    ...(session.injectedFiles || []),
    ...selected.filter(i => i.metadata.path).map(i => i.metadata.path as string),
  ];
  const newInjectedSymbols = [
    ...(session.injectedSymbols || []),
    ...selected.filter(i => i.metadata.qualifiedName).map(i => i.metadata.qualifiedName as string),
  ];

  await updateSession(session.id, {
    lastTurnCount: signal.turn_count,
    lastTokenEst: signal.estimated_tokens,
    injectedFiles: newInjectedFiles,
    injectedSymbols: newInjectedSymbols,
    activeConcern: activeConcern,
  });

  return {
    markdown,
    token_estimate: estimateTokens(markdown),
    compaction_detected: compactionDetected,
  };
}

/**
 * Save a compaction checkpoint. Called from PreCompact hook.
 * Stores current working state so it can be recovered after compaction.
 */
export async function saveCheckpoint(
  sessionId: string,
  repoId: string,
  data: {
    transcript_summary: string;
    files_in_context: string[];
    symbols_in_context: string[];
  },
): Promise<void> {
  const session = await db.query.contextEngineSessions.findFirst({
    where: and(
      eq(contextEngineSessions.sessionId, sessionId),
      eq(contextEngineSessions.repositoryId, repoId),
    ),
  });

  if (!session) return;

  await updateSession(session.id, {
    checkpointSummary: data.transcript_summary,
    checkpointFiles: data.files_in_context,
    checkpointSymbols: data.symbols_in_context,
  });
}

/**
 * Get focused context on demand (for MCP tools).
 * Same scoring pipeline as generateTurnContext but without session state mutation.
 */
export async function getFocusedContext(
  repoId: string,
  graph: GraphManager,
  params: {
    files?: string[];
    symbols?: string[];
    concern?: ContextConcern;
    max_tokens?: number;
  },
): Promise<ContextResult> {
  const concern = params.concern || 'codebase';
  const maxTokens = params.max_tokens || 2000;

  const [fileItems, symbolItems] = await Promise.all([
    expandFilesFromGraph(graph, params.files || [], concern, 15),
    expandSymbolsFromGraph(graph, params.symbols || [], concern, 10),
  ]);

  const allItems = [...fileItems, ...symbolItems];
  allItems.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Budget-fit
  const selected: RankedContextItem[] = [];
  let tokenCount = 0;
  for (const item of allItems) {
    const itemTokens = estimateTokens(item.content);
    if (tokenCount + itemTokens > maxTokens) continue;
    selected.push(item);
    tokenCount += itemTokens;
  }

  const markdown = formatContextMarkdown(selected, 'Focused Context', false);

  return {
    markdown,
    token_estimate: estimateTokens(markdown),
    compaction_detected: false,
  };
}
