/**
 * Context Engine API Routes
 * Knowledge-graph-driven context injection for Claude Code sessions.
 *
 * Base path: /api/v1/repos/:owner/:repo/context-engine
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db';
import { repositories } from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { canUserAccessRepo } from '../services/repository.service';
import {
  initSessionContext,
  generateTurnContext,
  saveCheckpoint,
  type ContextConcern,
} from '../services/context-engine.service';
import { processEgress } from '../services/context-engine-egress.service';
import type { AppEnv } from '../app';

const contextEngineRoutes = new Hono<AppEnv>();

// ── Helper: resolve repo with access control ──────────────────────────

async function getRepository(owner: string, repo: string, userId: string | null) {
  const repository = await db.query.repositories.findFirst({
    where: eq(repositories.slug, repo),
    with: {
      organization: true,
      owner: true,
    },
  });

  if (!repository) return null;

  const ownerSlug = repository.organization?.slug || repository.owner?.username;
  if (ownerSlug !== owner) return null;

  const canAccess = await canUserAccessRepo(repository.id, userId);
  if (!canAccess) return null;

  return repository;
}

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

// ── POST /init — Initialize session context ───────────────────────────

contextEngineRoutes.post(
  '/:owner/:repo/context-engine/init',
  requireAuth,
  zValidator('json', initSchema),
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId')!;
    const body = c.req.valid('json');

    const repository = await getRepository(owner, repo, userId);
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

    const repository = await getRepository(owner, repo, userId);
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

    const repository = await getRepository(owner, repo, userId);
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

    const repository = await getRepository(owner, repo, userId);
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

export { contextEngineRoutes };
