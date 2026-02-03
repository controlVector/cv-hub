import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { getRepositoryByOwnerAndSlug, canUserAccessRepo } from '../services/repository.service';
import { parseCODEOWNERS, getOwnersForPaths, getSuggestedReviewers } from '../services/codeowners.service';
import { NotFoundError } from '../utils/errors';
import type { AppEnv } from '../app';

const codeownersRoutes = new Hono<AppEnv>();

// GET /api/v1/repos/:owner/:repo/codeowners - Get parsed CODEOWNERS data
codeownersRoutes.get('/repos/:owner/:repo/codeowners', requireAuth, async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const userId = c.get('userId')!;
  const ref = c.req.query('ref') || 'HEAD';

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  if (!await canUserAccessRepo(repository.id, userId)) {
    throw new NotFoundError('Repository');
  }

  const ownerSlug = owner;
  const codeowners = await parseCODEOWNERS(ownerSlug, repoSlug, ref);

  if (!codeowners) {
    return c.json({ exists: false, entries: [], path: null, errors: [] });
  }

  return c.json({
    exists: true,
    entries: codeowners.entries,
    path: codeowners.path,
    errors: codeowners.errors,
  });
});

export { codeownersRoutes };
