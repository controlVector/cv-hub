import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { requireAuth, optionalAuth } from '../middleware/auth';
import {
  listRepositories,
  listPublicRepositories,
  getRepositoryById,
  getRepositoryByOwnerAndSlug,
  createRepository,
  updateRepository,
  deleteRepository,
  setRepositoryArchived,
  listRepositoryMembers,
  addRepositoryMember,
  updateRepositoryMemberRole,
  removeRepositoryMember,
  starRepository,
  unstarRepository,
  hasUserStarredRepo,
  watchRepository,
  unwatchRepository,
  getUserWatchStatus,
  getUserAccessibleRepositories,
  getUserStarredRepositories,
  canUserAccessRepo,
  canUserWriteToRepo,
  isRepoAdmin,
} from '../services/repository.service';
import { logAuditEvent, type AuditAction } from '../services/audit.service';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import type { AppEnv } from '../app';

const repoRoutes = new Hono<AppEnv>();

// Validation schemas
const visibilities = ['public', 'internal', 'private'] as const;
const providers = ['local', 'github', 'gitlab'] as const;
const repoRoles = ['admin', 'write', 'read'] as const;

// Helper to get request metadata
function getRequestMeta(c: any) {
  const forwarded = c.req.header('x-forwarded-for');
  return {
    ipAddress: forwarded ? forwarded.split(',')[0].trim() : undefined,
    userAgent: c.req.header('user-agent'),
  };
}

// ============================================================================
// Public Repository APIs
// ============================================================================

// GET /api/v1/repos - List public repositories (or user's repos if authenticated)
const listReposSchema = z.object({
  search: z.string().max(100).optional(),
  visibility: z.enum(visibilities).optional(),
  provider: z.enum(providers).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

repoRoutes.get('/repos', optionalAuth, zValidator('query', listReposSchema), async (c) => {
  const query = c.req.valid('query');
  const userId = c.get('userId');

  const filters = {
    search: query.search,
    visibility: query.visibility,
    provider: query.provider,
    includeArchived: query.includeArchived === 'true',
    limit: query.limit,
    offset: query.offset,
  };

  let repos;
  if (userId) {
    // Authenticated: show user's accessible repos
    repos = await getUserAccessibleRepositories(userId, filters);
  } else {
    // Public: only show public repos
    repos = await listPublicRepositories(filters);
  }

  return c.json({
    repositories: repos,
    pagination: {
      limit: filters.limit || 50,
      offset: filters.offset || 0,
      total: repos.length, // TODO: implement proper count
    },
  });
});

// GET /api/v1/repos/starred - Get user's starred repos
repoRoutes.get('/repos/starred', requireAuth, async (c) => {
  const userId = c.get('userId')!;
  const repos = await getUserStarredRepositories(userId);

  return c.json({ repositories: repos });
});

// GET /api/v1/dashboard/stats - Get dashboard statistics for current user
repoRoutes.get('/dashboard/stats', requireAuth, async (c) => {
  const userId = c.get('userId')!;

  // Get user's accessible repos with their stats
  const repos = await getUserAccessibleRepositories(userId, { limit: 100 });

  // Calculate totals
  const totalRepos = repos.length;
  const totalOpenPRs = repos.reduce((sum, r) => sum + (r.openPrCount || 0), 0);
  const totalOpenIssues = repos.reduce((sum, r) => sum + (r.openIssueCount || 0), 0);

  // Get recent repos (sorted by update time)
  const recentRepos = repos
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5)
    .map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      fullName: `${r.owner?.slug || 'user'}/${r.slug}`,
      description: r.description,
      visibility: r.visibility,
      starCount: r.starCount,
      openIssueCount: r.openIssueCount,
      openPrCount: r.openPrCount,
      graphSyncStatus: r.graphSyncStatus,
      updatedAt: r.updatedAt,
    }));

  return c.json({
    stats: {
      repositories: totalRepos,
      pullRequests: totalOpenPRs,
      openIssues: totalOpenIssues,
    },
    recentRepositories: recentRepos,
  });
});

// GET /api/v1/repos/:owner/:repo - Get repository by owner and slug
repoRoutes.get('/repos/:owner/:repo', optionalAuth, async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const userId = c.get('userId');

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  // Check access
  const canAccess = await canUserAccessRepo(repository.id, userId || null);
  if (!canAccess) {
    throw new NotFoundError('Repository'); // Don't reveal existence
  }

  // Add user-specific info
  let isStarred = false;
  let watchStatus: string | null = null;
  let userRole: string | null = null;

  if (userId) {
    isStarred = await hasUserStarredRepo(repository.id, userId);
    watchStatus = await getUserWatchStatus(repository.id, userId);
    const { getUserRepoRole } = await import('../services/repository.service');
    userRole = await getUserRepoRole(repository.id, userId);
  }

  return c.json({
    repository,
    userContext: userId ? { isStarred, watchStatus, role: userRole } : null,
  });
});

// ============================================================================
// Repository CRUD (authenticated)
// ============================================================================

// POST /api/v1/repos - Create repository
const createRepoSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens').optional(),
  description: z.string().max(500).optional(),
  visibility: z.enum(visibilities).optional(),
  provider: z.enum(providers).optional(),
  organizationId: z.string().uuid().optional(),
  defaultBranch: z.string().max(255).optional(),
  hasIssues: z.boolean().optional(),
  hasPullRequests: z.boolean().optional(),
});

repoRoutes.post('/repos', requireAuth, zValidator('json', createRepoSchema), async (c) => {
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);
  const userId = c.get('userId')!;

  // If creating under an org, verify user is an admin
  if (input.organizationId) {
    const { isOrgAdmin } = await import('../services/organization.service');
    if (!await isOrgAdmin(input.organizationId, userId)) {
      throw new ForbiddenError('You must be an admin to create repos in this organization');
    }
  }

  // Generate slug from name if not provided
  const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const repo = await createRepository(
    {
      ...input,
      slug,
      organizationId: input.organizationId || null,
      userId: input.organizationId ? null : userId, // Personal repo if no org
    },
    userId
  );

  await logAuditEvent({
    userId,
    action: 'repository.created' as AuditAction,
    resource: 'repository',
    resourceId: repo.id,
    details: { name: repo.name, slug: repo.slug },
    status: 'success',
    ...meta,
  });

  return c.json({ repository: repo }, 201);
});

// PUT /api/v1/repos/:owner/:repo - Update repository
const updateRepoSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  visibility: z.enum(visibilities).optional(),
  defaultBranch: z.string().max(255).optional(),
  hasIssues: z.boolean().optional(),
  hasPullRequests: z.boolean().optional(),
  hasWiki: z.boolean().optional(),
});

repoRoutes.put('/repos/:owner/:repo', requireAuth, zValidator('json', updateRepoSchema), async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  // Check admin access
  if (!await isRepoAdmin(repository.id, userId)) {
    throw new ForbiddenError('Admin access required');
  }

  const updated = await updateRepository(repository.id, input);

  await logAuditEvent({
    userId,
    action: 'repository.updated' as AuditAction,
    resource: 'repository',
    resourceId: repository.id,
    status: 'success',
    ...meta,
  });

  return c.json({ repository: updated });
});

// DELETE /api/v1/repos/:owner/:repo - Delete repository
repoRoutes.delete('/repos/:owner/:repo', requireAuth, async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const meta = getRequestMeta(c);
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  // Check admin access
  if (!await isRepoAdmin(repository.id, userId)) {
    throw new ForbiddenError('Admin access required');
  }

  await deleteRepository(repository.id);

  await logAuditEvent({
    userId,
    action: 'repository.deleted' as AuditAction,
    resource: 'repository',
    resourceId: repository.id,
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

// POST /api/v1/repos/:owner/:repo/archive - Archive repository
repoRoutes.post('/repos/:owner/:repo/archive', requireAuth, async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const meta = getRequestMeta(c);
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  if (!await isRepoAdmin(repository.id, userId)) {
    throw new ForbiddenError('Admin access required');
  }

  const updated = await setRepositoryArchived(repository.id, true);

  await logAuditEvent({
    userId,
    action: 'repository.archived' as AuditAction,
    resource: 'repository',
    resourceId: repository.id,
    status: 'success',
    ...meta,
  });

  return c.json({ repository: updated });
});

// POST /api/v1/repos/:owner/:repo/unarchive - Unarchive repository
repoRoutes.post('/repos/:owner/:repo/unarchive', requireAuth, async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const meta = getRequestMeta(c);
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  if (!await isRepoAdmin(repository.id, userId)) {
    throw new ForbiddenError('Admin access required');
  }

  const updated = await setRepositoryArchived(repository.id, false);

  await logAuditEvent({
    userId,
    action: 'repository.unarchived' as AuditAction,
    resource: 'repository',
    resourceId: repository.id,
    status: 'success',
    ...meta,
  });

  return c.json({ repository: updated });
});

// ============================================================================
// Repository Members
// ============================================================================

// GET /api/v1/repos/:owner/:repo/members - List members
repoRoutes.get('/repos/:owner/:repo/members', requireAuth, async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  if (!await canUserAccessRepo(repository.id, userId)) {
    throw new NotFoundError('Repository');
  }

  const members = await listRepositoryMembers(repository.id);

  return c.json({ members });
});

// POST /api/v1/repos/:owner/:repo/members - Add member
const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(repoRoles).optional(),
});

repoRoutes.post('/repos/:owner/:repo/members', requireAuth, zValidator('json', addMemberSchema), async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  if (!await isRepoAdmin(repository.id, userId)) {
    throw new ForbiddenError('Admin access required');
  }

  const member = await addRepositoryMember(
    repository.id,
    input.userId,
    input.role || 'read',
    userId
  );

  await logAuditEvent({
    userId,
    action: 'repository.member_added' as AuditAction,
    resource: 'repository',
    resourceId: repository.id,
    details: { memberId: input.userId, role: input.role },
    status: 'success',
    ...meta,
  });

  return c.json({ member }, 201);
});

// PUT /api/v1/repos/:owner/:repo/members/:memberId - Update member role
const updateMemberSchema = z.object({
  role: z.enum(repoRoles),
});

repoRoutes.put('/repos/:owner/:repo/members/:memberId', requireAuth, zValidator('json', updateMemberSchema), async (c) => {
  const { owner, repo: repoSlug, memberId } = c.req.param();
  const input = c.req.valid('json');
  const meta = getRequestMeta(c);
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  if (!await isRepoAdmin(repository.id, userId)) {
    throw new ForbiddenError('Admin access required');
  }

  const member = await updateRepositoryMemberRole(repository.id, memberId, input.role);
  if (!member) {
    throw new NotFoundError('Member');
  }

  await logAuditEvent({
    userId,
    action: 'repository.member_updated' as AuditAction,
    resource: 'repository',
    resourceId: repository.id,
    details: { memberId, newRole: input.role },
    status: 'success',
    ...meta,
  });

  return c.json({ member });
});

// DELETE /api/v1/repos/:owner/:repo/members/:memberId - Remove member
repoRoutes.delete('/repos/:owner/:repo/members/:memberId', requireAuth, async (c) => {
  const { owner, repo: repoSlug, memberId } = c.req.param();
  const meta = getRequestMeta(c);
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  if (!await isRepoAdmin(repository.id, userId)) {
    throw new ForbiddenError('Admin access required');
  }

  await removeRepositoryMember(repository.id, memberId);

  await logAuditEvent({
    userId,
    action: 'repository.member_removed' as AuditAction,
    resource: 'repository',
    resourceId: repository.id,
    details: { memberId },
    status: 'success',
    ...meta,
  });

  return c.json({ success: true });
});

// ============================================================================
// Stars & Watchers
// ============================================================================

// POST /api/v1/repos/:owner/:repo/star - Star repository
repoRoutes.post('/repos/:owner/:repo/star', requireAuth, async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  if (!await canUserAccessRepo(repository.id, userId)) {
    throw new NotFoundError('Repository');
  }

  const success = await starRepository(repository.id, userId);

  return c.json({ starred: success });
});

// DELETE /api/v1/repos/:owner/:repo/star - Unstar repository
repoRoutes.delete('/repos/:owner/:repo/star', requireAuth, async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  const success = await unstarRepository(repository.id, userId);

  return c.json({ starred: !success });
});

// POST /api/v1/repos/:owner/:repo/watch - Watch repository
const watchSchema = z.object({
  level: z.enum(['all', 'releases', 'ignore']).optional(),
});

repoRoutes.post('/repos/:owner/:repo/watch', requireAuth, zValidator('json', watchSchema), async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const input = c.req.valid('json');
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  if (!await canUserAccessRepo(repository.id, userId)) {
    throw new NotFoundError('Repository');
  }

  await watchRepository(repository.id, userId, input.level || 'all');

  return c.json({ watching: true, level: input.level || 'all' });
});

// DELETE /api/v1/repos/:owner/:repo/watch - Unwatch repository
repoRoutes.delete('/repos/:owner/:repo/watch', requireAuth, async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const userId = c.get('userId')!;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  await unwatchRepository(repository.id, userId);

  return c.json({ watching: false });
});

export { repoRoutes as repositoryRoutes };
