/**
 * Fork Routes
 * Create and list repository forks
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { db } from '../db';
import { repositories } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as forkService from '../services/fork.service';
import { NotFoundError, ValidationError, ConflictError } from '../utils/errors';
import type { AppEnv } from '../app';

const forkRoutes = new Hono<AppEnv>();

// ============================================================================
// Helper to get repository by owner/repo
// ============================================================================

async function getRepository(owner: string, repo: string) {
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

  return repository;
}

// ============================================================================
// Fork Endpoints
// ============================================================================

/**
 * POST /repos/:owner/:repo/forks
 * Create a fork of the repository
 */
const createForkSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  organization_id: z.string().uuid().optional(),
});

forkRoutes.post(
  '/repos/:owner/:repo/forks',
  requireAuth,
  zValidator('json', createForkSchema),
  async (c) => {
    const { owner, repo } = c.req.param();
    const userId = c.get('userId')!;
    const body = c.req.valid('json');

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    try {
      const result = await forkService.forkRepository(
        repository.id,
        userId,
        {
          name: body.name,
          organizationId: body.organization_id,
        }
      );

      return c.json({ repository: result.repository }, 201);
    } catch (error: any) {
      if (error instanceof ConflictError) {
        return c.json({ error: error.message }, 409);
      }
      if (error instanceof ValidationError) {
        return c.json({ error: error.message }, 400);
      }
      if (error instanceof NotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  }
);

/**
 * GET /repos/:owner/:repo/forks
 * List forks of a repository
 */
const listForksSchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

forkRoutes.get(
  '/repos/:owner/:repo/forks',
  zValidator('query', listForksSchema),
  async (c) => {
    const { owner, repo } = c.req.param();
    const { limit, offset } = c.req.valid('query');

    const repository = await getRepository(owner, repo);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const result = await forkService.listForks(repository.id, { limit, offset });

    return c.json({
      forks: result.forks,
      total: result.total,
    });
  }
);

export { forkRoutes };
