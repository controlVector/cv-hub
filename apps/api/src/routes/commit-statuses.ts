/**
 * Commit Status Routes
 * API endpoints for reporting and querying commit status checks
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { resolveRepository } from '../middleware/resolve-repository';
import * as statusService from '../services/commit-status.service';
import { ValidationError } from '../utils/errors';
import type { AppEnv } from '../app';

const commitStatusRoutes = new Hono<AppEnv>();

// ============================================================================
// Status Endpoints
// ============================================================================

/**
 * POST /repos/:owner/:repo/statuses/:sha
 * Create a commit status
 */
const createStatusSchema = z.object({
  state: z.enum(['pending', 'success', 'failure', 'error']),
  context: z.string().max(255).optional(),
  description: z.string().max(255).optional(),
  target_url: z.string().url().optional(),
});

commitStatusRoutes.post(
  '/repos/:owner/:repo/statuses/:sha',
  requireAuth,
  zValidator('json', createStatusSchema),
  async (c) => {
    const { owner, repo, sha } = c.req.param();
    const userId = c.get('userId')!;
    const body = c.req.valid('json');

    const repository = await resolveRepository(owner, repo, c.get('userId') ?? null);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    try {
      const status = await statusService.createCommitStatus({
        repositoryId: repository.id,
        sha,
        state: body.state,
        context: body.context,
        description: body.description,
        targetUrl: body.target_url,
        creatorId: userId,
      });

      return c.json({ status }, 201);
    } catch (error: any) {
      if (error instanceof ValidationError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  }
);

/**
 * GET /repos/:owner/:repo/commits/:sha/statuses
 * List all statuses for a commit
 */
commitStatusRoutes.get(
  '/repos/:owner/:repo/commits/:sha/statuses',
  async (c) => {
    const { owner, repo, sha } = c.req.param();

    const repository = await resolveRepository(owner, repo, c.get('userId') ?? null);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const statuses = await statusService.getCommitStatuses(repository.id, sha);
    return c.json({ statuses });
  }
);

/**
 * GET /repos/:owner/:repo/commits/:sha/status
 * Get combined status for a commit
 */
commitStatusRoutes.get(
  '/repos/:owner/:repo/commits/:sha/status',
  async (c) => {
    const { owner, repo, sha } = c.req.param();

    const repository = await resolveRepository(owner, repo, c.get('userId') ?? null);
    if (!repository) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    const combined = await statusService.getCombinedStatus(repository.id, sha);
    return c.json(combined);
  }
);

export { commitStatusRoutes };
