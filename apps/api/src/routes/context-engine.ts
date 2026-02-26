/**
 * Context Engine API Routes
 * Knowledge-graph-driven context injection for Claude Code sessions.
 *
 * Base path: /api/v1/repos/:owner/:repo/context-engine
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs/promises';
import { db } from '../db';
import { contextEngineSessions } from '../db/schema';
import { eq, desc, and, gte, count, sql, inArray } from 'drizzle-orm';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { resolveRepository } from '../middleware/resolve-repository';
import { getUserAccessibleRepoIds } from '../services/repository.service';
import { getGraphManager } from '../services/graph';
import { env } from '../config/env';
import {
  initSessionContext,
  generateTurnContext,
  saveCheckpoint,
  type ContextConcern,
} from '../services/context-engine.service';
import { processEgress } from '../services/context-engine-egress.service';
import type { AppEnv } from '../app';

const contextEngineRoutes = new Hono<AppEnv>();

// ── Schemas ───────────────────────────────────────────────────────────

const concernEnum = z.enum(['codebase', 'deployment', 'compilation', 'business']);

const initSchema = z.object({
  session_id: z.string().min(1).max(128),
  executor_id: z.string().uuid().optional(),
  concern: concernEnum.default('codebase'),
  max_tokens: z.number().int().min(500).max(10000).optional(),
});

const turnSchema = z.object({
  session_id: z.string().min(1).max(128),
  files_touched: z.array(z.string()).default([]),
  symbols_referenced: z.array(z.string()).default([]),
  turn_count: z.number().int().min(0),
  estimated_tokens_used: z.number().int().min(0),
  concern: concernEnum.default('codebase'),
});

const checkpointSchema = z.object({
  session_id: z.string().min(1).max(128),
  transcript_summary: z.string().max(5000),
  files_in_context: z.array(z.string()).default([]),
  symbols_in_context: z.array(z.string()).default([]),
});

// ── GET /health — Context engine health for a repo ────────────────────

contextEngineRoutes.get(
  '/:owner/:repo/context-engine/health',
  optionalAuth,
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId') ?? null;

    const repository = await resolveRepository(owner, repo, userId);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const ownerSlug = repository.organization?.slug || repository.owner?.username || owner;

    // 1. Graph connectivity — can the adapter reach FalkorDB?
    let graphConnected = false;
    let graphLatencyMs = 0;
    try {
      const start = performance.now();
      const graph = await getGraphManager(repository.id);
      await graph.query('RETURN 1');
      graphLatencyMs = Math.round(performance.now() - start);
      graphConnected = true;
    } catch {
      graphLatencyMs = 0;
    }

    // 2. SK node count
    let skNodeCount = 0;
    // 3. Last egress timestamp
    let lastEgressTimestamp: number | null = null;
    if (graphConnected) {
      try {
        const graph = await getGraphManager(repository.id);
        const [countResult, latestResult] = await Promise.all([
          graph.query('MATCH (sk:SessionKnowledge) RETURN count(sk) AS cnt'),
          graph.query(
            'MATCH (sk:SessionKnowledge) RETURN sk.timestamp AS ts ORDER BY sk.timestamp DESC LIMIT 1',
          ),
        ]);
        skNodeCount = (countResult[0] as any)?.cnt ?? 0;
        lastEgressTimestamp = (latestResult[0] as any)?.ts ?? null;
      } catch {
        // graph queries failed — counts stay at defaults
      }
    }

    // 4. Hooks detected — check if .claude/hooks/session-start.sh exists on disk
    let hooksInstalled = false;
    try {
      const repoPath = path.join(env.GIT_STORAGE_PATH, ownerSlug, `${repository.slug}.git`);
      const hookPath = path.join(repoPath, '.claude', 'hooks', 'session-start.sh');
      await fs.access(hookPath);
      hooksInstalled = true;
    } catch {
      // file doesn't exist or not accessible
    }

    // 5. Active sessions — sessions with activity in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    let activeSessions = 0;
    try {
      const result = await db.select({ total: count() })
        .from(contextEngineSessions)
        .where(
          and(
            eq(contextEngineSessions.repositoryId, repository.id),
            gte(contextEngineSessions.lastActivityAt, oneHourAgo),
          ),
        );
      activeSessions = result[0]?.total ?? 0;
    } catch {
      // db query failed
    }

    return c.json({
      success: true,
      data: {
        graph: {
          connected: graphConnected,
          latencyMs: graphLatencyMs,
        },
        skNodeCount,
        lastEgressTimestamp,
        hooksInstalled,
        activeSessions,
      },
    });
  },
);

// ── POST /init — Initialize session context ───────────────────────────

contextEngineRoutes.post(
  '/:owner/:repo/context-engine/init',
  requireAuth,
  zValidator('json', initSchema),
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId')!;
    const body = c.req.valid('json');

    const repository = await resolveRepository(owner, repo, userId);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    try {
      const ownerSlug = repository.organization?.slug || repository.owner?.username || owner;
      const result = await initSessionContext(repository.id, ownerSlug, repository.slug, {
        session_id: body.session_id,
        user_id: userId,
        executor_id: body.executor_id,
        concern: body.concern as ContextConcern,
        max_tokens: body.max_tokens,
      });

      return c.json({
        success: true,
        data: {
          context_markdown: result.markdown,
          token_estimate: result.token_estimate,
        },
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── POST /turn — Turn-by-turn context injection ──────────────────────

contextEngineRoutes.post(
  '/:owner/:repo/context-engine/turn',
  requireAuth,
  zValidator('json', turnSchema),
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId')!;
    const body = c.req.valid('json');

    const repository = await resolveRepository(owner, repo, userId);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    try {
      const result = await generateTurnContext(repository.id, {
        session_id: body.session_id,
        files_touched: body.files_touched,
        symbols_referenced: body.symbols_referenced,
        turn_count: body.turn_count,
        estimated_tokens: body.estimated_tokens_used,
        concern: body.concern as ContextConcern,
      });

      return c.json({
        success: true,
        data: {
          context_markdown: result.markdown,
          token_estimate: result.token_estimate,
          compaction_detected: result.compaction_detected,
        },
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── POST /checkpoint — Save compaction checkpoint ────────────────────

contextEngineRoutes.post(
  '/:owner/:repo/context-engine/checkpoint',
  requireAuth,
  zValidator('json', checkpointSchema),
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId')!;
    const body = c.req.valid('json');

    const repository = await resolveRepository(owner, repo, userId);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    try {
      await saveCheckpoint(body.session_id, repository.id, {
        transcript_summary: body.transcript_summary,
        files_in_context: body.files_in_context,
        symbols_in_context: body.symbols_in_context,
      });

      return c.json({
        success: true,
        data: { checkpoint_saved: true },
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── POST /egress — Push session knowledge to graph ───────────────────

const egressSchema = z.object({
  session_id: z.string().min(1).max(128),
  turn_number: z.number().int().min(1),
  transcript_segment: z.string().min(1).max(50000),
  files_touched: z.array(z.string()).default([]),
  symbols_referenced: z.array(z.string()).default([]),
  concern: concernEnum.default('codebase'),
});

contextEngineRoutes.post(
  '/:owner/:repo/context-engine/egress',
  requireAuth,
  zValidator('json', egressSchema),
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId')!;
    const body = c.req.valid('json');

    const repository = await resolveRepository(owner, repo, userId);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    try {
      const result = await processEgress({
        sessionId: body.session_id,
        turnNumber: body.turn_number,
        transcriptSegment: body.transcript_segment,
        filesTouched: body.files_touched,
        symbolsReferenced: body.symbols_referenced,
        concern: body.concern,
        repositoryId: repository.id,
        organizationId: repository.organizationId || null,
      });

      return c.json({
        success: true,
        data: {
          knowledge_node_id: result.knowledgeNodeId,
          file_summaries_updated: result.fileSummariesUpdated,
          symbol_summaries_updated: result.symbolSummariesUpdated,
          edges_created: result.edgesCreated,
          vector_stored: result.vectorStored,
        },
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── GET /sessions — List context engine sessions ──────────────────────

contextEngineRoutes.get(
  '/:owner/:repo/context-engine/sessions',
  optionalAuth,
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId') ?? null;
    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100));
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);

    const repository = await resolveRepository(owner, repo, userId);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    try {
      const [sessions, totalResult] = await Promise.all([
        db.query.contextEngineSessions.findMany({
          where: eq(contextEngineSessions.repositoryId, repository.id),
          orderBy: [desc(contextEngineSessions.lastActivityAt)],
          limit,
          offset,
        }),
        db.select({ total: count() })
          .from(contextEngineSessions)
          .where(eq(contextEngineSessions.repositoryId, repository.id)),
      ]);

      return c.json({
        success: true,
        data: {
          sessions: sessions.map((s) => ({
            sessionId: s.sessionId,
            userId: s.userId,
            activeConcern: s.activeConcern,
            lastTurnCount: s.lastTurnCount,
            lastTokenEst: s.lastTokenEst,
            lastActivityAt: s.lastActivityAt,
            createdAt: s.createdAt,
          })),
          pagination: { limit, offset, total: totalResult[0]?.total ?? 0 },
        },
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── GET /sessions/:sessionId/timeline — Session knowledge timeline ────

contextEngineRoutes.get(
  '/:owner/:repo/context-engine/sessions/:sessionId/timeline',
  optionalAuth,
  async (c) => {
    const { owner, repo, sessionId } = c.req.param();
    const userId = c.get('userId') ?? null;

    const repository = await resolveRepository(owner, repo, userId);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    try {
      const graph = await getGraphManager(repository.id);
      const results = await graph.query(
        `MATCH (sk:SessionKnowledge {sessionId: $sessionId})
         RETURN sk.turnNumber AS turnNumber, sk.timestamp AS timestamp,
                sk.summary AS summary, sk.concern AS concern,
                sk.filesTouched AS filesTouched, sk.symbolsReferenced AS symbolsReferenced
         ORDER BY sk.turnNumber ASC`,
        { sessionId },
      );

      return c.json({
        success: true,
        data: {
          sessionId,
          turns: results.map((r: any) => ({
            turnNumber: r.turnNumber ?? 0,
            timestamp: r.timestamp ?? 0,
            summary: r.summary || '',
            concern: r.concern || '',
            filesTouched: r.filesTouched || [],
            symbolsReferenced: r.symbolsReferenced || [],
          })),
        },
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── GET /knowledge — List all SessionKnowledge nodes ──────────────────

contextEngineRoutes.get(
  '/:owner/:repo/context-engine/knowledge',
  optionalAuth,
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId') ?? null;
    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100));
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);
    const concern = c.req.query('concern');
    const file = c.req.query('file');

    const repository = await resolveRepository(owner, repo, userId);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    try {
      const graph = await getGraphManager(repository.id);

      // Build WHERE clauses dynamically
      const conditions: string[] = [];
      const params: Record<string, any> = { limit, offset };

      if (concern) {
        conditions.push('sk.concern = $concern');
        params.concern = concern;
      }
      if (file) {
        conditions.push('$file IN sk.filesTouched');
        params.file = file;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const results = await graph.query(
        `MATCH (sk:SessionKnowledge)
         ${whereClause}
         RETURN sk.sessionId AS sessionId, sk.turnNumber AS turnNumber,
                sk.timestamp AS timestamp, sk.summary AS summary,
                sk.concern AS concern, sk.filesTouched AS filesTouched,
                sk.symbolsReferenced AS symbolsReferenced
         ORDER BY sk.timestamp DESC
         SKIP $offset LIMIT $limit`,
        params,
      );

      return c.json({
        success: true,
        data: {
          knowledge: results.map((r: any) => ({
            sessionId: r.sessionId || '',
            turnNumber: r.turnNumber ?? 0,
            timestamp: r.timestamp ?? 0,
            summary: r.summary || '',
            concern: r.concern || '',
            filesTouched: r.filesTouched || [],
            symbolsReferenced: r.symbolsReferenced || [],
          })),
          pagination: { limit, offset, hasMore: results.length === limit },
        },
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── GET /stats — Aggregated context engine stats ──────────────────────

contextEngineRoutes.get(
  '/:owner/:repo/context-engine/stats',
  optionalAuth,
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId') ?? null;

    const repository = await resolveRepository(owner, repo, userId);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    try {
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const graph = await getGraphManager(repository.id);

      const [
        totalSessionsResult,
        activeSessionsResult,
        skCountResult,
        aboutCountResult,
        followsCountResult,
        topFilesResult,
      ] = await Promise.all([
        db.select({ total: count() })
          .from(contextEngineSessions)
          .where(eq(contextEngineSessions.repositoryId, repository.id)),
        db.select({ total: count() })
          .from(contextEngineSessions)
          .where(
            and(
              eq(contextEngineSessions.repositoryId, repository.id),
              gte(contextEngineSessions.lastActivityAt, twentyFourHoursAgo),
            ),
          ),
        graph.query('MATCH (sk:SessionKnowledge) RETURN count(sk) AS cnt'),
        graph.query('MATCH ()-[r:ABOUT]->() RETURN count(r) AS cnt'),
        graph.query('MATCH ()-[r:FOLLOWS]->() RETURN count(r) AS cnt'),
        graph.query(
          `MATCH (sk:SessionKnowledge)
           UNWIND sk.filesTouched AS f
           WITH f, count(*) AS mentions
           RETURN f AS file, mentions
           ORDER BY mentions DESC
           LIMIT 10`,
        ),
      ]);

      return c.json({
        success: true,
        data: {
          totalSessions: totalSessionsResult[0]?.total ?? 0,
          activeSessions: activeSessionsResult[0]?.total ?? 0,
          totalKnowledgeNodes: (skCountResult[0] as any)?.cnt ?? 0,
          totalAboutEdges: (aboutCountResult[0] as any)?.cnt ?? 0,
          totalFollowsEdges: (followsCountResult[0] as any)?.cnt ?? 0,
          topFiles: topFilesResult.map((r: any) => ({
            file: r.file || '',
            mentions: r.mentions ?? 0,
          })),
        },
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── GET /graph-data — VizData for knowledge graph visualization ───────

contextEngineRoutes.get(
  '/:owner/:repo/context-engine/graph-data',
  optionalAuth,
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId') ?? null;
    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '300', 10) || 300, 1000));

    const repository = await resolveRepository(owner, repo, userId);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    try {
      const graph = await getGraphManager(repository.id);

      // Fetch SK nodes and their ABOUT targets (File/Symbol)
      const aboutResults = await graph.query(
        `MATCH (sk:SessionKnowledge)-[r:ABOUT]->(target)
         RETURN sk.sessionId AS skSessionId, sk.turnNumber AS skTurnNumber,
                sk.timestamp AS skTimestamp, sk.summary AS skSummary,
                sk.concern AS skConcern,
                labels(target) AS targetLabels,
                target.path AS targetPath, target.qualifiedName AS targetQualifiedName,
                target.name AS targetName, target.language AS targetLanguage,
                target.kind AS targetKind, target.complexity AS targetComplexity,
                target.summary AS targetSummary,
                r.role AS aboutRole
         LIMIT $limit`,
        { limit },
      );

      // Fetch FOLLOWS edges between SK nodes
      const followsResults = await graph.query(
        `MATCH (sk1:SessionKnowledge)-[:FOLLOWS]->(sk2:SessionKnowledge)
         RETURN sk1.sessionId AS fromSession, sk1.turnNumber AS fromTurn,
                sk2.sessionId AS toSession, sk2.turnNumber AS toTurn
         LIMIT $limit`,
        { limit },
      );

      // Build deduplicated node and edge sets
      const nodeMap = new Map<string, any>();
      const edges: any[] = [];

      for (const r of aboutResults as any[]) {
        // SK node
        const skId = `sk:${r.skSessionId}:${r.skTurnNumber}`;
        if (!nodeMap.has(skId)) {
          nodeMap.set(skId, {
            id: skId,
            label: `Turn ${r.skTurnNumber}`,
            type: 'session_knowledge',
            sessionId: r.skSessionId,
            turnNumber: r.skTurnNumber,
            concern: r.skConcern || '',
            summary: r.skSummary || '',
          });
        }

        // Target node (File or Symbol)
        const labels: string[] = r.targetLabels || [];
        const isFile = labels.includes('File');
        const targetId = isFile
          ? (r.targetPath || r.targetQualifiedName || 'unknown')
          : (r.targetQualifiedName || r.targetPath || 'unknown');
        if (!nodeMap.has(targetId)) {
          nodeMap.set(targetId, {
            id: targetId,
            label: isFile
              ? (r.targetPath?.split('/').pop() || r.targetPath || 'unknown')
              : (r.targetName || targetId.split(':').pop() || 'unknown'),
            type: isFile ? 'file' : 'symbol',
            path: r.targetPath,
            language: r.targetLanguage,
            kind: r.targetKind,
            complexity: r.targetComplexity || 0,
            summary: r.targetSummary,
          });
        }

        // ABOUT edge
        edges.push({
          source: skId,
          target: targetId,
          type: 'ABOUT',
        });
      }

      // FOLLOWS edges
      for (const r of followsResults as any[]) {
        const fromId = `sk:${r.fromSession}:${r.fromTurn}`;
        const toId = `sk:${r.toSession}:${r.toTurn}`;
        if (nodeMap.has(fromId) && nodeMap.has(toId)) {
          edges.push({
            source: fromId,
            target: toId,
            type: 'FOLLOWS',
          });
        }
      }

      const nodes = Array.from(nodeMap.values());

      return c.json({
        success: true,
        data: {
          nodes,
          edges,
          meta: {
            viewType: 'knowledge',
            nodeCount: nodes.length,
            edgeCount: edges.length,
            truncated: aboutResults.length >= limit,
          },
        },
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ══════════════════════════════════════════════════════════════════════
// Global (non-repo-scoped) Context Engine Routes
// Base path: /api/v1/context-engine
// ══════════════════════════════════════════════════════════════════════

const globalContextEngineRoutes = new Hono<AppEnv>();

// ── GET /stats — Aggregate stats across all user-accessible repos ─────

globalContextEngineRoutes.get(
  '/context-engine/stats',
  requireAuth,
  async (c) => {
    const userId = c.get('userId')!;

    try {
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Get repos the user can access — scope all queries to these
      const accessibleRepoIds = await getUserAccessibleRepoIds(userId);

      // Aggregate from Postgres across all repos the user has sessions for
      const [totalResult, activeResult] = await Promise.all([
        db.select({ total: count() })
          .from(contextEngineSessions)
          .where(eq(contextEngineSessions.userId, userId)),
        db.select({ total: count() })
          .from(contextEngineSessions)
          .where(
            and(
              eq(contextEngineSessions.userId, userId),
              gte(contextEngineSessions.lastActivityAt, twentyFourHoursAgo),
            ),
          ),
      ]);

      // Get distinct repos the user has CE sessions for, filtered by current access
      const repoRows = await db
        .selectDistinctOn([contextEngineSessions.repositoryId], {
          repositoryId: contextEngineSessions.repositoryId,
        })
        .from(contextEngineSessions)
        .where(eq(contextEngineSessions.userId, userId));

      // Only include repos the user still has access to
      const accessibleSet = new Set(accessibleRepoIds);
      const repoIds = repoRows
        .map(r => r.repositoryId)
        .filter(id => accessibleSet.has(id))
        .slice(0, 20);

      // Aggregate FalkorDB stats across accessible repos
      let totalKnowledgeNodes = 0;
      let totalAboutEdges = 0;
      let totalFollowsEdges = 0;

      for (const repoId of repoIds) {
        try {
          const graph = await getGraphManager(repoId);
          const [skResult, aboutResult, followsResult] = await Promise.all([
            graph.query('MATCH (sk:SessionKnowledge) RETURN count(sk) AS cnt'),
            graph.query('MATCH ()-[r:ABOUT]->() RETURN count(r) AS cnt'),
            graph.query('MATCH ()-[r:FOLLOWS]->() RETURN count(r) AS cnt'),
          ]);
          totalKnowledgeNodes += (skResult[0] as any)?.cnt ?? 0;
          totalAboutEdges += (aboutResult[0] as any)?.cnt ?? 0;
          totalFollowsEdges += (followsResult[0] as any)?.cnt ?? 0;
        } catch {
          // Skip repos with no graph or connection issues
        }
      }

      return c.json({
        success: true,
        data: {
          totalSessions: totalResult[0]?.total ?? 0,
          activeSessions: activeResult[0]?.total ?? 0,
          totalKnowledgeNodes,
          totalAboutEdges,
          totalFollowsEdges,
          repoCount: repoRows.length,
        },
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── GET /sessions — Cross-repo session list ───────────────────────────

globalContextEngineRoutes.get(
  '/context-engine/sessions',
  requireAuth,
  async (c) => {
    const userId = c.get('userId')!;
    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100));
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);

    try {
      // Get repos the user can access — scope session list to these
      const accessibleRepoIds = await getUserAccessibleRepoIds(userId);
      const accessFilter = accessibleRepoIds.length > 0
        ? and(
            eq(contextEngineSessions.userId, userId),
            inArray(contextEngineSessions.repositoryId, accessibleRepoIds),
          )
        : and(eq(contextEngineSessions.userId, userId), sql`false`);

      const [sessions, totalResult] = await Promise.all([
        db.query.contextEngineSessions.findMany({
          where: accessFilter,
          orderBy: [desc(contextEngineSessions.lastActivityAt)],
          limit,
          offset,
          with: {
            repository: {
              columns: { id: true, name: true, slug: true },
              with: {
                organization: { columns: { slug: true } },
                owner: { columns: { username: true } },
              },
            },
          },
        }),
        db.select({ total: count() })
          .from(contextEngineSessions)
          .where(accessFilter!),
      ]);

      return c.json({
        success: true,
        data: {
          sessions: sessions.map((s) => {
            const ownerSlug = (s.repository as any)?.organization?.slug
              || (s.repository as any)?.owner?.username
              || '';
            return {
              sessionId: s.sessionId,
              repositoryId: s.repositoryId,
              repoName: (s.repository as any)?.name || '',
              repoSlug: (s.repository as any)?.slug || '',
              repoOwner: ownerSlug,
              activeConcern: s.activeConcern,
              lastTurnCount: s.lastTurnCount,
              lastTokenEst: s.lastTokenEst,
              lastActivityAt: s.lastActivityAt,
              createdAt: s.createdAt,
            };
          }),
          pagination: { limit, offset, total: totalResult[0]?.total ?? 0 },
        },
      });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

export { contextEngineRoutes, globalContextEngineRoutes };
