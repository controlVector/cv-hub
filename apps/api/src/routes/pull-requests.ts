/**
 * Pull Request Routes
 * CRUD and workflow operations for pull requests
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { db } from '../db';
import { repositories } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as prService from '../services/pr.service';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import type { AppEnv } from '../app';

const prRoutes = new Hono<AppEnv>();

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
// PR CRUD
// ============================================================================

/**
 * GET /repos/:owner/:repo/pulls
 * List pull requests for a repository
 */
const listPRsSchema = z.object({
  state: z.enum(['open', 'closed', 'merged', 'draft', 'all']).optional(),
  author: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

prRoutes.get('/repos/:owner/:repo/pulls', zValidator('query', listPRsSchema), async (c) => {
  const { owner, repo } = c.req.param();
  const { state, author, limit, offset } = c.req.valid('query');

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  if (!repository.hasPullRequests) {
    return c.json({ error: 'Pull requests are disabled for this repository' }, 400);
  }

  const result = await prService.listPullRequests(repository.id, {
    state: state as any,
    authorId: author,
    limit,
    offset,
  });

  return c.json({
    pullRequests: result.pullRequests,
    total: result.total,
  });
});

/**
 * POST /repos/:owner/:repo/pulls
 * Create a new pull request
 */
const createPRSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().optional(),
  sourceBranch: z.string().min(1),
  targetBranch: z.string().min(1),
  isDraft: z.boolean().optional(),
  labels: z.array(z.string()).optional(),
});

prRoutes.post('/repos/:owner/:repo/pulls', requireAuth, zValidator('json', createPRSchema), async (c) => {
  const { owner, repo } = c.req.param();
  const userId = c.get('userId')!;
  const body = c.req.valid('json');

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  if (!repository.hasPullRequests) {
    return c.json({ error: 'Pull requests are disabled for this repository' }, 400);
  }

  try {
    const pr = await prService.createPullRequest({
      repositoryId: repository.id,
      authorId: userId,
      ...body,
    });

    return c.json({ pullRequest: pr }, 201);
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

/**
 * GET /repos/:owner/:repo/pulls/:number
 * Get a specific pull request
 */
prRoutes.get('/repos/:owner/:repo/pulls/:number', async (c) => {
  const { owner, repo, number } = c.req.param();

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const pr = await prService.getPullRequestByNumber(repository.id, parseInt(number));
  if (!pr) {
    return c.json({ error: 'Pull request not found' }, 404);
  }

  return c.json({ pullRequest: pr });
});

/**
 * PATCH /repos/:owner/:repo/pulls/:number
 * Update a pull request
 */
const updatePRSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  body: z.string().optional(),
  state: z.enum(['open', 'closed']).optional(),
  targetBranch: z.string().optional(),
  isDraft: z.boolean().optional(),
  labels: z.array(z.string()).optional(),
});

prRoutes.patch('/repos/:owner/:repo/pulls/:number', requireAuth, zValidator('json', updatePRSchema), async (c) => {
  const { owner, repo, number } = c.req.param();
  const userId = c.get('userId')!;
  const body = c.req.valid('json');

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const pr = await prService.getPullRequestByNumber(repository.id, parseInt(number));
  if (!pr) {
    return c.json({ error: 'Pull request not found' }, 404);
  }

  try {
    const updated = await prService.updatePullRequest(pr.id, body, userId);
    return c.json({ pullRequest: updated });
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

// ============================================================================
// PR Actions
// ============================================================================

/**
 * PUT /repos/:owner/:repo/pulls/:number/merge
 * Merge a pull request
 */
const mergeSchema = z.object({
  mergeMethod: z.enum(['merge', 'squash', 'rebase']).optional(),
});

prRoutes.put('/repos/:owner/:repo/pulls/:number/merge', requireAuth, zValidator('json', mergeSchema), async (c) => {
  const { owner, repo, number } = c.req.param();
  const userId = c.get('userId')!;
  const { mergeMethod } = c.req.valid('json');

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const pr = await prService.getPullRequestByNumber(repository.id, parseInt(number));
  if (!pr) {
    return c.json({ error: 'Pull request not found' }, 404);
  }

  try {
    const merged = await prService.mergePullRequest(pr.id, userId, mergeMethod);
    return c.json({ pullRequest: merged, merged: true });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

/**
 * POST /repos/:owner/:repo/pulls/:number/reopen
 * Reopen a closed pull request
 */
prRoutes.post('/repos/:owner/:repo/pulls/:number/reopen', requireAuth, async (c) => {
  const { owner, repo, number } = c.req.param();
  const userId = c.get('userId')!;

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const pr = await prService.getPullRequestByNumber(repository.id, parseInt(number));
  if (!pr) {
    return c.json({ error: 'Pull request not found' }, 404);
  }

  try {
    const reopened = await prService.reopenPullRequest(pr.id, userId);
    return c.json({ pullRequest: reopened });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

// ============================================================================
// Reviews
// ============================================================================

/**
 * GET /repos/:owner/:repo/pulls/:number/reviews
 * Get reviews for a pull request
 */
prRoutes.get('/repos/:owner/:repo/pulls/:number/reviews', async (c) => {
  const { owner, repo, number } = c.req.param();

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const pr = await prService.getPullRequestByNumber(repository.id, parseInt(number));
  if (!pr) {
    return c.json({ error: 'Pull request not found' }, 404);
  }

  const reviews = await prService.getReviews(pr.id);
  return c.json({ reviews });
});

/**
 * POST /repos/:owner/:repo/pulls/:number/reviews
 * Submit a review
 */
const reviewSchema = z.object({
  state: z.enum(['approved', 'changes_requested', 'commented']),
  body: z.string().optional(),
});

prRoutes.post('/repos/:owner/:repo/pulls/:number/reviews', requireAuth, zValidator('json', reviewSchema), async (c) => {
  const { owner, repo, number } = c.req.param();
  const userId = c.get('userId')!;
  const { state, body } = c.req.valid('json');

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  const pr = await prService.getPullRequestByNumber(repository.id, parseInt(number));
  if (!pr) {
    return c.json({ error: 'Pull request not found' }, 404);
  }

  const review = await prService.submitReview(pr.id, userId, state, body);
  return c.json({ review }, 201);
});

/**
 * DELETE /repos/:owner/:repo/pulls/:number/reviews/:reviewId
 * Dismiss a review
 */
prRoutes.delete('/repos/:owner/:repo/pulls/:number/reviews/:reviewId', requireAuth, async (c) => {
  const { owner, repo, number, reviewId } = c.req.param();
  const userId = c.get('userId')!;

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const dismissed = await prService.dismissReview(reviewId, userId);
    return c.json({ review: dismissed });
  } catch (error: any) {
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    throw error;
  }
});

// ============================================================================
// Diff
// ============================================================================

/**
 * GET /repos/:owner/:repo/pulls/:number/diff
 * Get the diff for a pull request
 */
prRoutes.get('/repos/:owner/:repo/pulls/:number/diff', async (c) => {
  const { owner, repo, number } = c.req.param();

  const repository = await getRepository(owner, repo);
  if (!repository) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  try {
    const diff = await prService.getPullRequestDiff(repository.id, parseInt(number));
    return c.json({ diff });
  } catch (error: any) {
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof ValidationError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

// ============================================================================
// User's PRs
// ============================================================================

/**
 * GET /user/pulls
 * Get PRs authored by the current user
 */
const userPRsSchema = z.object({
  state: z.enum(['open', 'closed', 'merged', 'all']).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

prRoutes.get('/user/pulls', requireAuth, zValidator('query', userPRsSchema), async (c) => {
  const userId = c.get('userId')!;
  const { state, limit, offset } = c.req.valid('query');

  const prs = await prService.getUserPullRequests(userId, {
    state: state as any,
    limit,
    offset,
  });

  return c.json({ pullRequests: prs });
});

/**
 * GET /user/pulls/review-requests
 * Get PRs where user has pending review requests
 */
prRoutes.get('/user/pulls/review-requests', requireAuth, async (c) => {
  const userId = c.get('userId')!;

  const prs = await prService.getUserReviewRequests(userId);
  return c.json({ pullRequests: prs });
});

export default prRoutes;
