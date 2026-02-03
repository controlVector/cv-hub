import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getRepositoryByOwnerAndSlug, isRepoAdmin } from '../services/repository.service';
import { addTagProtection, removeTagProtection, listTagProtection, getTagProtection } from '../services/tag-protection.service';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import type { AppEnv } from '../app';

const tagProtectionRoutes = new Hono<AppEnv>();

// GET /api/v1/repos/:owner/:repo/tag-protection - List tag protection rules
tagProtectionRoutes.get('/repos/:owner/:repo/tag-protection', requireAuth, async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  if (!await isRepoAdmin(repository.id, userId)) {
    throw new ForbiddenError('Admin access required');
  }

  const rules = await listTagProtection(repository.id);

  return c.json({ rules });
});

// POST /api/v1/repos/:owner/:repo/tag-protection - Create tag protection rule
const createSchema = z.object({
  pattern: z.string().min(1).max(255),
  allowAdminOverride: z.boolean().optional().default(true),
});

tagProtectionRoutes.post('/repos/:owner/:repo/tag-protection', requireAuth, zValidator('json', createSchema), async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const input = c.req.valid('json');
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  if (!await isRepoAdmin(repository.id, userId)) {
    throw new ForbiddenError('Admin access required');
  }

  const rule = await addTagProtection(repository.id, input.pattern, userId, input.allowAdminOverride);

  return c.json({ rule }, 201);
});

// GET /api/v1/repos/:owner/:repo/tag-protection/:id - Get a tag protection rule
tagProtectionRoutes.get('/repos/:owner/:repo/tag-protection/:id', requireAuth, async (c) => {
  const { owner, repo: repoSlug, id } = c.req.param();
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  if (!await isRepoAdmin(repository.id, userId)) {
    throw new ForbiddenError('Admin access required');
  }

  const rule = await getTagProtection(id, repository.id);

  return c.json({ rule });
});

// DELETE /api/v1/repos/:owner/:repo/tag-protection/:id - Delete tag protection rule
tagProtectionRoutes.delete('/repos/:owner/:repo/tag-protection/:id', requireAuth, async (c) => {
  const { owner, repo: repoSlug, id } = c.req.param();
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  if (!await isRepoAdmin(repository.id, userId)) {
    throw new ForbiddenError('Admin access required');
  }

  await removeTagProtection(id, repository.id);

  return c.json({ success: true });
});

export { tagProtectionRoutes };
