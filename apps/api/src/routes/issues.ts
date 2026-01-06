/**
 * Issue Routes
 * CRUD and tracking operations for issues
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { db } from '../db';
import { repositories } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as issueService from '../services/issue.service';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import type { AppEnv } from '../app';

const issueRoutes = new Hono<AppEnv>();

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
// Issue CRUD
// ============================================================================

/**
 * GET /repos/:owner/:repo/issues
 * List issues for a repository
 */
const listIssuesSchema = z.object({
  state: z.enum(['open', 'closed', 'all']).optional(),
  author: z.string().optional(),
  assignee: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  labels: z.string().optional(), // comma-separated
  milestone: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

issueRoutes.get('/repos/:owner/:repo/issues', optionalAuth, zValidator('query', listIssuesSchema), async (c) => {
  const { owner, repo } = c.req.param();
  const query = c.req.valid('query');

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  if (!repository.hasIssues) {
    return c.json({ error: 'Issues are disabled for this repository' }, 400);
  }

  const result = await issueService.listIssues(repository.id, {
    state: query.state as any,
    authorId: query.author,
    assigneeId: query.assignee,
    priority: query.priority as any,
    labels: query.labels?.split(',').map(l => l.trim()),
    milestone: query.milestone,
    search: query.search,
    limit: query.limit,
    offset: query.offset,
  });

  return c.json({
    issues: result.issues,
    total: result.total,
  });
});

/**
 * POST /repos/:owner/:repo/issues
 * Create a new issue
 */
const createIssueSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  labels: z.array(z.string()).optional(),
  assigneeIds: z.array(z.string()).optional(),
  milestone: z.string().optional(),
});

issueRoutes.post('/repos/:owner/:repo/issues', requireAuth, zValidator('json', createIssueSchema), async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId')!;
  const body = c.req.valid('json');

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  if (!repository.hasIssues) {
    return c.json({ error: 'Issues are disabled for this repository' }, 400);
  }

  try {
    const issue = await issueService.createIssue({
      repositoryId: repository.id,
      authorId: userId,
      ...body,
    });

    return c.json({ issue }, 201);
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

/**
 * GET /repos/:owner/:repo/issues/:number
 * Get a specific issue
 */
issueRoutes.get('/repos/:owner/:repo/issues/:number', async (c) => {
  const { owner, repo, number } = c.req.param();

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const issue = await issueService.getIssueByNumber(repository.id, parseInt(number));
  if (!issue) {
    return c.json({ error: 'Issue not found' }, 404);
  }

  return c.json({ issue });
});

/**
 * PATCH /repos/:owner/:repo/issues/:number
 * Update an issue
 */
const updateIssueSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  body: z.string().optional(),
  state: z.enum(['open', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  labels: z.array(z.string()).optional(),
  assigneeIds: z.array(z.string()).optional(),
  milestone: z.string().nullable().optional(),
});

issueRoutes.patch('/repos/:owner/:repo/issues/:number', requireAuth, zValidator('json', updateIssueSchema), async (c) => {
  const { owner, repo, number } = c.req.param();
  const userId = c.get('userId')!;
  const body = c.req.valid('json');

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const issue = await issueService.getIssueByNumber(repository.id, parseInt(number));
  if (!issue) {
    return c.json({ error: 'Issue not found' }, 404);
  }

  try {
    const updated = await issueService.updateIssue(issue.id, body, userId);
    return c.json({ issue: updated });
  } catch (error: any) {
    if (error instanceof ForbiddenError) {
      return c.json({ error: error.message }, 403);
    }
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

/**
 * DELETE /repos/:owner/:repo/issues/:number
 * Delete an issue
 */
issueRoutes.delete('/repos/:owner/:repo/issues/:number', requireAuth, async (c) => {
  const { owner, repo, number } = c.req.param();
  const userId = c.get('userId')!;

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const issue = await issueService.getIssueByNumber(repository.id, parseInt(number));
  if (!issue) {
    return c.json({ error: 'Issue not found' }, 404);
  }

  try {
    await issueService.deleteIssue(issue.id, userId);
    return c.json({ success: true });
  } catch (error: any) {
    if (error instanceof ForbiddenError) {
      return c.json({ error: error.message }, 403);
    }
    throw error;
  }
});

// ============================================================================
// Issue Actions
// ============================================================================

/**
 * POST /repos/:owner/:repo/issues/:number/close
 * Close an issue
 */
issueRoutes.post('/repos/:owner/:repo/issues/:number/close', requireAuth, async (c) => {
  const { owner, repo, number } = c.req.param();
  const userId = c.get('userId')!;

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const issue = await issueService.getIssueByNumber(repository.id, parseInt(number));
  if (!issue) {
    return c.json({ error: 'Issue not found' }, 404);
  }

  const closed = await issueService.closeIssue(issue.id, userId);
  return c.json({ issue: closed });
});

/**
 * POST /repos/:owner/:repo/issues/:number/reopen
 * Reopen a closed issue
 */
issueRoutes.post('/repos/:owner/:repo/issues/:number/reopen', requireAuth, async (c) => {
  const { owner, repo, number } = c.req.param();
  const userId = c.get('userId')!;

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const issue = await issueService.getIssueByNumber(repository.id, parseInt(number));
  if (!issue) {
    return c.json({ error: 'Issue not found' }, 404);
  }

  const reopened = await issueService.reopenIssue(issue.id, userId);
  return c.json({ issue: reopened });
});

// ============================================================================
// Comments
// ============================================================================

/**
 * GET /repos/:owner/:repo/issues/:number/comments
 * Get comments for an issue
 */
issueRoutes.get('/repos/:owner/:repo/issues/:number/comments', async (c) => {
  const { owner, repo, number } = c.req.param();

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const issue = await issueService.getIssueByNumber(repository.id, parseInt(number));
  if (!issue) {
    return c.json({ error: 'Issue not found' }, 404);
  }

  const comments = await issueService.getComments(issue.id);
  return c.json({ comments });
});

/**
 * POST /repos/:owner/:repo/issues/:number/comments
 * Add a comment to an issue
 */
const commentSchema = z.object({
  body: z.string().min(1),
});

issueRoutes.post('/repos/:owner/:repo/issues/:number/comments', requireAuth, zValidator('json', commentSchema), async (c) => {
  const { owner, repo, number } = c.req.param();
  const userId = c.get('userId')!;
  const { body } = c.req.valid('json');

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const issue = await issueService.getIssueByNumber(repository.id, parseInt(number));
  if (!issue) {
    return c.json({ error: 'Issue not found' }, 404);
  }

  const comment = await issueService.addComment(issue.id, userId, body);
  return c.json({ comment }, 201);
});

/**
 * PATCH /repos/:owner/:repo/issues/:number/comments/:commentId
 * Update a comment
 */
issueRoutes.patch('/repos/:owner/:repo/issues/:number/comments/:commentId', requireAuth, zValidator('json', commentSchema), async (c) => {
  const { commentId } = c.req.param();
  const userId = c.get('userId')!;
  const { body } = c.req.valid('json');

  try {
    const updated = await issueService.updateComment(commentId, userId, body);
    return c.json({ comment: updated });
  } catch (error: any) {
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof ForbiddenError) {
      return c.json({ error: error.message }, 403);
    }
    throw error;
  }
});

/**
 * DELETE /repos/:owner/:repo/issues/:number/comments/:commentId
 * Delete a comment
 */
issueRoutes.delete('/repos/:owner/:repo/issues/:number/comments/:commentId', requireAuth, async (c) => {
  const { commentId } = c.req.param();
  const userId = c.get('userId')!;

  try {
    await issueService.deleteComment(commentId, userId);
    return c.json({ success: true });
  } catch (error: any) {
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof ForbiddenError) {
      return c.json({ error: error.message }, 403);
    }
    throw error;
  }
});

// ============================================================================
// Labels & Milestones
// ============================================================================

/**
 * GET /repos/:owner/:repo/labels
 * Get all labels used in a repository
 */
issueRoutes.get('/repos/:owner/:repo/labels', async (c) => {
  const { owner, repo } = c.req.param();

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const labels = await issueService.getRepositoryLabels(repository.id);
  return c.json({ labels });
});

/**
 * GET /repos/:owner/:repo/milestones
 * Get all milestones used in a repository
 */
issueRoutes.get('/repos/:owner/:repo/milestones', async (c) => {
  const { owner, repo } = c.req.param();

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const milestones = await issueService.getRepositoryMilestones(repository.id);
  return c.json({ milestones });
});

// ============================================================================
// User's Issues
// ============================================================================

/**
 * GET /user/issues
 * Get issues authored by the current user
 */
const userIssuesSchema = z.object({
  state: z.enum(['open', 'closed', 'all']).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

issueRoutes.get('/user/issues', requireAuth, zValidator('query', userIssuesSchema), async (c) => {
  const userId = c.get('userId')!;
  const { state, limit, offset } = c.req.valid('query');

  const issues = await issueService.getUserIssues(userId, {
    state: state as any,
    limit,
    offset,
  });

  return c.json({ issues });
});

/**
 * GET /user/issues/assigned
 * Get issues assigned to the current user
 */
issueRoutes.get('/user/issues/assigned', requireAuth, zValidator('query', userIssuesSchema), async (c) => {
  const userId = c.get('userId')!;
  const { state, limit, offset } = c.req.valid('query');

  const issues = await issueService.getUserAssignedIssues(userId, {
    state: state as any,
    limit,
    offset,
  });

  return c.json({ issues });
});

export default issueRoutes;
