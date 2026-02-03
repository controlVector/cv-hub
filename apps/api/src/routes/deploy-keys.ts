import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getRepositoryByOwnerAndSlug, isRepoAdmin } from '../services/repository.service';
import { addDeployKey, removeDeployKey, listDeployKeys, getDeployKey } from '../services/deploy-keys.service';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import type { AppEnv } from '../app';

const deployKeyRoutes = new Hono<AppEnv>();

// GET /api/v1/repos/:owner/:repo/keys - List deploy keys
deployKeyRoutes.get('/repos/:owner/:repo/keys', requireAuth, async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  if (!await isRepoAdmin(repository.id, userId)) {
    throw new ForbiddenError('Admin access required');
  }

  const keys = await listDeployKeys(repository.id);

  return c.json({ keys });
});

// POST /api/v1/repos/:owner/:repo/keys - Add deploy key
const addKeySchema = z.object({
  title: z.string().min(1).max(255),
  key: z.string().min(1),
  readOnly: z.boolean().optional().default(true),
});

deployKeyRoutes.post('/repos/:owner/:repo/keys', requireAuth, zValidator('json', addKeySchema), async (c) => {
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

  const key = await addDeployKey(repository.id, input.title, input.key, input.readOnly);

  return c.json({ key }, 201);
});

// GET /api/v1/repos/:owner/:repo/keys/:id - Get deploy key
deployKeyRoutes.get('/repos/:owner/:repo/keys/:id', requireAuth, async (c) => {
  const { owner, repo: repoSlug, id } = c.req.param();
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  if (!await isRepoAdmin(repository.id, userId)) {
    throw new ForbiddenError('Admin access required');
  }

  const key = await getDeployKey(id, repository.id);

  return c.json({ key });
});

// DELETE /api/v1/repos/:owner/:repo/keys/:id - Remove deploy key
deployKeyRoutes.delete('/repos/:owner/:repo/keys/:id', requireAuth, async (c) => {
  const { owner, repo: repoSlug, id } = c.req.param();
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  if (!await isRepoAdmin(repository.id, userId)) {
    throw new ForbiddenError('Admin access required');
  }

  await removeDeployKey(id, repository.id);

  return c.json({ success: true });
});

export { deployKeyRoutes };
