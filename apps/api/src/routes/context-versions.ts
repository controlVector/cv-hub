/**
 * Context Versions API Routes
 * Store and retrieve context manifold snapshots for repositories.
 *
 * Base path: /api/v1/repos/:owner/:repo/context-versions
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db';
import { contextVersions } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { resolveRepository } from '../middleware/resolve-repository';
import type { AppEnv } from '../app';

const contextVersionRoutes = new Hono<AppEnv>();

// ── Schemas ──────────────────────────────────────────────────────────

const createSchema = z.object({
  commit_sha: z.string().min(7).max(40),
  nodes: z.array(z.unknown()).default([]),
  edges: z.array(z.unknown()).default([]),
  changes_summary: z.string().max(2000).optional(),
});

// ── POST /:owner/:repo/context-versions ─────────────────────────────
// Create a context version snapshot for a commit

contextVersionRoutes.post(
  '/:owner/:repo/context-versions',
  requireAuth,
  zValidator('json', createSchema),
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId') ?? null;
    const body = c.req.valid('json');

    const repository = await resolveRepository(owner, repo, userId);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const [version] = await db
      .insert(contextVersions)
      .values({
        repositoryId: repository.id,
        commitSha: body.commit_sha,
        nodes: body.nodes,
        edges: body.edges,
        nodeCount: body.nodes.length,
        changesSummary: body.changes_summary,
      })
      .onConflictDoUpdate({
        target: [contextVersions.repositoryId, contextVersions.commitSha],
        set: {
          nodes: body.nodes,
          edges: body.edges,
          nodeCount: body.nodes.length,
          changesSummary: body.changes_summary,
        },
      })
      .returning();

    return c.json(version, 201);
  },
);

// ── GET /:owner/:repo/context-versions ──────────────────────────────
// List context versions for a repository

contextVersionRoutes.get(
  '/:owner/:repo/context-versions',
  requireAuth,
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId') ?? null;
    const limit = parseInt(c.req.query('limit') || '20', 10);

    const repository = await resolveRepository(owner, repo, userId);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const versions = await db
      .select({
        id: contextVersions.id,
        commitSha: contextVersions.commitSha,
        nodeCount: contextVersions.nodeCount,
        changesSummary: contextVersions.changesSummary,
        createdAt: contextVersions.createdAt,
      })
      .from(contextVersions)
      .where(eq(contextVersions.repositoryId, repository.id))
      .orderBy(desc(contextVersions.createdAt))
      .limit(Math.min(limit, 100));

    return c.json(versions);
  },
);

// ── GET /:owner/:repo/context-versions/:sha ─────────────────────────
// Get a specific context version by commit SHA

contextVersionRoutes.get(
  '/:owner/:repo/context-versions/:sha',
  requireAuth,
  async (c) => {
    const { owner, repo, sha } = c.req.param();
    const userId = c.get('userId') ?? null;

    const repository = await resolveRepository(owner, repo, userId);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const [version] = await db
      .select()
      .from(contextVersions)
      .where(
        and(
          eq(contextVersions.repositoryId, repository.id),
          eq(contextVersions.commitSha, sha),
        ),
      )
      .limit(1);

    if (!version) {
      return c.json({ error: 'Context version not found' }, 404);
    }

    return c.json(version);
  },
);

export { contextVersionRoutes };
