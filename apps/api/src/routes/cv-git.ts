/**
 * CV-Git Integration Routes
 * API endpoints specifically designed for cv-git CLI integration
 *
 * These endpoints provide:
 * - Token-based authentication (no cookies)
 * - Repository discovery with clone URLs
 * - Code browsing (refs, tree, blob, commits)
 * - Graph sync status
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { env } from '../config/env';
import { db } from '../db';
import { repositories, apiKeys } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth, optionalAuth } from '../middleware/auth';
import {
  authenticateUser,
  getUserById,
} from '../services/user.service';
import {
  createSession,
} from '../services/session.service';
import {
  generateAccessToken,
  getAccessTokenExpiry,
} from '../services/token.service';
import {
  getRepositoryByOwnerAndSlug,
  canUserAccessRepo,
  canUserWriteToRepo,
} from '../services/repository.service';
import * as gitBackend from '../services/git/git-backend.service';
import { NotFoundError, ForbiddenError, AuthenticationError } from '../utils/errors';
import type { AppEnv } from '../app';

const cvGitRoutes = new Hono<AppEnv>();

// ============================================================================
// Authentication Endpoints (Token-based for CLI)
// ============================================================================

/**
 * POST /api/v1/auth/token
 * Exchange credentials for an access token (CLI auth flow)
 * cv-git uses this to authenticate without cookies
 */
const tokenSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

cvGitRoutes.post('/auth/token', zValidator('json', tokenSchema), async (c) => {
  const { email, password } = c.req.valid('json');

  try {
    const user = await authenticateUser(email, password);

    // Check if MFA is required
    if (user.mfaEnabled) {
      return c.json({
        error: 'MFA required',
        code: 'MFA_REQUIRED',
        message: 'This account has MFA enabled. Use API keys for CLI access, or complete MFA via web login.',
      }, 403);
    }

    // Create session for CLI
    const { sessionId } = await createSession({
      userId: user.id,
      userAgent: c.req.header('user-agent') || 'cv-git-cli',
    });

    // Generate access token
    const accessToken = await generateAccessToken(user.id, sessionId);

    return c.json({
      accessToken,
      tokenType: 'Bearer',
      expiresIn: getAccessTokenExpiry(),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    throw new AuthenticationError('Invalid credentials');
  }
});

/**
 * GET /api/v1/auth/whoami
 * Verify token and return user info
 * cv-git uses this to verify auth is working
 */
cvGitRoutes.get('/auth/whoami', requireAuth, async (c) => {
  const userId = c.get('userId')!;
  const user = await getUserById(userId);

  if (!user) {
    throw new AuthenticationError('User not found');
  }

  return c.json({
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  });
});

// ============================================================================
// Repository Discovery (with clone URLs)
// ============================================================================

/**
 * Helper to build clone URL for a repository
 */
function getCloneUrl(owner: string, repo: string): string {
  return `${env.API_URL}/git/${owner}/${repo}`;
}

/**
 * GET /api/v1/repos/:owner/:repo/clone-info
 * Get repository clone information for cv-git
 */
cvGitRoutes.get('/repos/:owner/:repo/clone-info', optionalAuth, async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const userId = c.get('userId');

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  // Check access
  const canAccess = await canUserAccessRepo(repository.id, userId || null);
  if (!canAccess) {
    throw new NotFoundError('Repository');
  }

  const canWrite = userId ? await canUserWriteToRepo(repository.id, userId) : false;

  return c.json({
    id: repository.id,
    name: repository.name,
    slug: repository.slug,
    description: repository.description,
    defaultBranch: repository.defaultBranch || 'main',
    visibility: repository.visibility,
    provider: repository.provider,
    gitUrl: getCloneUrl(owner, repoSlug),
    graphSyncStatus: repository.graphSyncStatus,
    permissions: {
      read: true,
      write: canWrite,
    },
  });
});

// ============================================================================
// Code Browsing Endpoints
// ============================================================================

/**
 * GET /api/v1/repos/:owner/:repo/refs
 * List all branches and tags
 */
cvGitRoutes.get('/repos/:owner/:repo/refs', optionalAuth, async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const userId = c.get('userId');

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  const canAccess = await canUserAccessRepo(repository.id, userId || null);
  if (!canAccess) {
    throw new NotFoundError('Repository');
  }

  if (repository.provider !== 'local') {
    // For external repos, return cached refs from database
    const branchList = await db.query.branches.findMany({
      where: eq(repositories.id, repository.id),
    });
    const tagList = await db.query.tags.findMany({
      where: eq(repositories.id, repository.id),
    });

    return c.json({
      branches: branchList.map(b => ({
        name: b.name,
        sha: b.sha,
        isDefault: b.isDefault,
        isProtected: b.isProtected,
      })),
      tags: tagList.map(t => ({
        name: t.name,
        sha: t.sha,
        message: t.message,
      })),
      defaultBranch: repository.defaultBranch,
    });
  }

  // For local repos, get from git
  try {
    const refs = await gitBackend.getRefs(owner, repoSlug);

    const branches = refs.filter(r => r.type === 'branch');
    const tags = refs.filter(r => r.type === 'tag');

    return c.json({
      branches: branches.map(b => ({
        name: b.name,
        sha: b.sha,
        isDefault: b.name === repository.defaultBranch,
      })),
      tags: tags.map(t => ({
        name: t.name,
        sha: t.sha,
      })),
      defaultBranch: repository.defaultBranch,
    });
  } catch (error: any) {
    if (
      error.message.includes('not found') ||
      error.message.includes('ENOENT') ||
      error.message.includes('does not exist')
    ) {
      // Empty repo or no git directory
      return c.json({
        branches: [],
        tags: [],
        defaultBranch: repository.defaultBranch,
      });
    }
    throw error;
  }
});

/**
 * GET /api/v1/repos/:owner/:repo/tree/:ref/*path
 * Get directory tree at a specific ref and path
 */
cvGitRoutes.get('/repos/:owner/:repo/tree/:ref/*', optionalAuth, async (c) => {
  const { owner, repo: repoSlug, ref } = c.req.param();
  const path = c.req.path.split(`/tree/${ref}/`)[1] || '';
  const userId = c.get('userId');

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  const canAccess = await canUserAccessRepo(repository.id, userId || null);
  if (!canAccess) {
    throw new NotFoundError('Repository');
  }

  if (repository.provider !== 'local') {
    return c.json({
      error: 'Tree browsing not available for external repositories',
      code: 'EXTERNAL_REPO',
    }, 400);
  }

  try {
    const tree = await gitBackend.getTree(owner, repoSlug, ref, path);

    return c.json({
      ref,
      path: path || '/',
      entries: tree.map(entry => ({
        name: entry.name,
        path: entry.path,
        type: entry.type, // 'blob' or 'tree'
        mode: entry.mode,
        sha: entry.sha,
        size: entry.size,
      })),
    });
  } catch (error: any) {
    if (
      error.message.includes('not found') ||
      error.message.includes('ENOENT') ||
      error.message.includes('does not exist')
    ) {
      throw new NotFoundError('Path or ref');
    }
    throw error;
  }
});

/**
 * GET /api/v1/repos/:owner/:repo/blob/:ref/*path
 * Get file content at a specific ref and path
 */
cvGitRoutes.get('/repos/:owner/:repo/blob/:ref/*', optionalAuth, async (c) => {
  const { owner, repo: repoSlug, ref } = c.req.param();
  const path = c.req.path.split(`/blob/${ref}/`)[1] || '';
  const userId = c.get('userId');

  if (!path) {
    return c.json({ error: 'Path required' }, 400);
  }

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  const canAccess = await canUserAccessRepo(repository.id, userId || null);
  if (!canAccess) {
    throw new NotFoundError('Repository');
  }

  if (repository.provider !== 'local') {
    return c.json({
      error: 'Blob browsing not available for external repositories',
      code: 'EXTERNAL_REPO',
    }, 400);
  }

  try {
    const blob = await gitBackend.getBlob(owner, repoSlug, ref, path);

    // Determine if binary
    const isBinary = blob.content.includes('\0') ||
      /[\x00-\x08\x0E-\x1F]/.test(blob.content.slice(0, 1000));

    return c.json({
      ref,
      path,
      sha: blob.sha,
      size: blob.size,
      isBinary,
      content: isBinary ? null : blob.content,
      encoding: isBinary ? 'base64' : 'utf-8',
      contentBase64: isBinary ? Buffer.from(blob.content).toString('base64') : null,
    });
  } catch (error: any) {
    if (
      error.message.includes('not found') ||
      error.message.includes('ENOENT') ||
      error.message.includes('does not exist')
    ) {
      throw new NotFoundError('File or ref');
    }
    throw error;
  }
});

/**
 * GET /api/v1/repos/:owner/:repo/commits
 * Get commit history
 */
const commitsQuerySchema = z.object({
  ref: z.string().optional(),
  path: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

cvGitRoutes.get('/repos/:owner/:repo/commits', optionalAuth, zValidator('query', commitsQuerySchema), async (c) => {
  const { owner, repo: repoSlug } = c.req.param();
  const query = c.req.valid('query');
  const userId = c.get('userId');

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  const canAccess = await canUserAccessRepo(repository.id, userId || null);
  if (!canAccess) {
    throw new NotFoundError('Repository');
  }

  const ref = query.ref || repository.defaultBranch || 'main';
  const limit = query.limit || 30;

  if (repository.provider !== 'local') {
    // Return cached commits from database
    const commits = await db.query.commits.findMany({
      where: eq(repositories.id, repository.id),
      limit,
      offset: query.offset || 0,
    });

    return c.json({
      ref,
      commits: commits.map(commit => ({
        sha: commit.sha,
        message: commit.message,
        author: {
          name: commit.authorName,
          email: commit.authorEmail,
          date: commit.authorDate,
        },
        committer: {
          name: commit.committerName,
          email: commit.committerEmail,
          date: commit.committerDate,
        },
      })),
    });
  }

  try {
    const commits = await gitBackend.getCommitHistory(owner, repoSlug, ref, { limit });

    return c.json({
      ref,
      commits: commits.map(commit => ({
        sha: commit.sha,
        message: commit.message,
        author: commit.author,
        committer: commit.committer,
        parents: commit.parents,
      })),
    });
  } catch (error: any) {
    if (
      error.message.includes('not found') ||
      error.message.includes('ENOENT') ||
      error.message.includes('does not exist')
    ) {
      return c.json({ ref, commits: [] });
    }
    throw error;
  }
});

/**
 * GET /api/v1/repos/:owner/:repo/commits/:sha
 * Get a specific commit
 */
cvGitRoutes.get('/repos/:owner/:repo/commits/:sha', optionalAuth, async (c) => {
  const { owner, repo: repoSlug, sha } = c.req.param();
  const userId = c.get('userId');

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  const canAccess = await canUserAccessRepo(repository.id, userId || null);
  if (!canAccess) {
    throw new NotFoundError('Repository');
  }

  if (repository.provider !== 'local') {
    // Check database
    const commit = await db.query.commits.findFirst({
      where: and(
        eq(repositories.id, repository.id),
        eq(repositories.id, repository.id) // TODO: fix this - need commits table ref
      ),
    });

    if (!commit) {
      throw new NotFoundError('Commit');
    }

    return c.json({ commit });
  }

  try {
    const commit = await gitBackend.getCommit(owner, repoSlug, sha);

    return c.json({
      commit: {
        sha: commit.sha,
        message: commit.message,
        author: commit.author,
        committer: commit.committer,
        parents: commit.parents,
      },
    });
  } catch (error: any) {
    if (
      error.message.includes('not found') ||
      error.message.includes('does not exist')
    ) {
      throw new NotFoundError('Commit');
    }
    throw error;
  }
});

/**
 * GET /api/v1/repos/:owner/:repo/blame/:ref/*path
 * Get blame information for a file
 */
cvGitRoutes.get('/repos/:owner/:repo/blame/:ref/*', optionalAuth, async (c) => {
  const { owner, repo: repoSlug, ref } = c.req.param();
  const path = c.req.path.split(`/blame/${ref}/`)[1] || '';
  const userId = c.get('userId');

  if (!path) {
    return c.json({ error: 'Path required' }, 400);
  }

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  const canAccess = await canUserAccessRepo(repository.id, userId || null);
  if (!canAccess) {
    throw new NotFoundError('Repository');
  }

  if (repository.provider !== 'local') {
    return c.json({
      error: 'Blame not available for external repositories',
      code: 'EXTERNAL_REPO',
    }, 400);
  }

  try {
    const blame = await gitBackend.getBlame(owner, repoSlug, ref, path);

    return c.json({
      ref,
      path,
      lines: blame,
    });
  } catch (error: any) {
    if (
      error.message.includes('not found') ||
      error.message.includes('ENOENT') ||
      error.message.includes('does not exist')
    ) {
      throw new NotFoundError('File or ref');
    }
    throw error;
  }
});

/**
 * GET /api/v1/repos/:owner/:repo/compare/:base...:head
 * Compare two refs
 */
cvGitRoutes.get('/repos/:owner/:repo/compare/:baseHead', optionalAuth, async (c) => {
  const { owner, repo: repoSlug, baseHead } = c.req.param();
  const userId = c.get('userId');

  // Parse base...head or base..head
  const match = baseHead.match(/^(.+?)\.{2,3}(.+)$/);
  if (!match) {
    return c.json({ error: 'Invalid compare format. Use base...head or base..head' }, 400);
  }

  const [, base, head] = match;

  const repository = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repository) {
    throw new NotFoundError('Repository');
  }

  const canAccess = await canUserAccessRepo(repository.id, userId || null);
  if (!canAccess) {
    throw new NotFoundError('Repository');
  }

  if (repository.provider !== 'local') {
    return c.json({
      error: 'Compare not available for external repositories',
      code: 'EXTERNAL_REPO',
    }, 400);
  }

  try {
    const diff = await gitBackend.getDiff(owner, repoSlug, base, head);

    return c.json({
      base,
      head,
      ...diff,
    });
  } catch (error: any) {
    if (
      error.message.includes('not found') ||
      error.message.includes('does not exist')
    ) {
      throw new NotFoundError('Ref');
    }
    throw error;
  }
});

export default cvGitRoutes;
