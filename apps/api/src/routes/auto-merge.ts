import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { db } from '../db';
import { repositories, pullRequests } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { getRepositoryByOwnerAndSlug, canUserWriteToRepo } from '../services/repository.service';
import { enableAutoMerge, disableAutoMerge, getAutoMergeStatus } from '../services/auto-merge.service';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import type { AppEnv } from '../app';

const autoMergeRoutes = new Hono<AppEnv>();

/**
 * Resolve PR by owner/repo/number
 */
async function resolvePR(owner: string, repoSlug: string, number: string) {
  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  const pr = await db.query.pullRequests.findFirst({
    where: and(
      eq(pullRequests.repositoryId, repository.id),
      eq(pullRequests.number, parseInt(number, 10)),
    ),
  });

  if (!pr) {
    throw new NotFoundError('Pull request not found');
  }

  return { repository, pr };
}

// POST /api/v1/repos/:owner/:repo/pulls/:number/auto-merge - Enable auto-merge
const enableSchema = z.object({
  mergeMethod: z.enum(['merge', 'squash', 'rebase']).optional().default('merge'),
});

autoMergeRoutes.post('/repos/:owner/:repo/pulls/:number/auto-merge', requireAuth, zValidator('json', enableSchema), async (c) => {
  const { owner, repo: repoSlug, number } = c.req.param();
  const input = c.req.valid('json');
  const userId = c.get('userId')!;

  const { repository, pr } = await resolvePR(owner, repoSlug, number);

  if (!await canUserWriteToRepo(repository.id, userId)) {
    throw new ForbiddenError('Write access required');
  }

  const status = await enableAutoMerge(pr.id, userId, input.mergeMethod);

  return c.json({ autoMerge: status });
});

// DELETE /api/v1/repos/:owner/:repo/pulls/:number/auto-merge - Disable auto-merge
autoMergeRoutes.delete('/repos/:owner/:repo/pulls/:number/auto-merge', requireAuth, async (c) => {
  const { owner, repo: repoSlug, number } = c.req.param();
  const userId = c.get('userId')!;

  const { repository, pr } = await resolvePR(owner, repoSlug, number);

  if (!await canUserWriteToRepo(repository.id, userId)) {
    throw new ForbiddenError('Write access required');
  }

  const status = await disableAutoMerge(pr.id);

  return c.json({ autoMerge: status });
});

// GET /api/v1/repos/:owner/:repo/pulls/:number/auto-merge - Get auto-merge status
autoMergeRoutes.get('/repos/:owner/:repo/pulls/:number/auto-merge', requireAuth, async (c) => {
  const { owner, repo: repoSlug, number } = c.req.param();
  const userId = c.get('userId')!;

  const { repository, pr } = await resolvePR(owner, repoSlug, number);

  const status = await getAutoMergeStatus(pr.id);

  return c.json({ autoMerge: status });
});

export { autoMergeRoutes };
