/**
 * Pull Request Service
 * Manages pull request CRUD and workflow operations
 */

import { db } from '../db';
import {
  pullRequests,
  pullRequestReviews,
  comments,
  repositories,
  users,
  branches,
  type PullRequest,
  type NewPullRequest,
  type PullRequestReview,
  type NewPullRequestReview,
  type PRState,
  type ReviewState,
} from '../db/schema';
import { eq, and, desc, sql, count, or, inArray } from 'drizzle-orm';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import * as gitBackend from './git/git-backend.service';
import { triggerEvent } from './webhook.service';
import { notifyPRReview, notifyPRMerged } from './notification.service';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface CreatePRInput {
  repositoryId: string;
  title: string;
  body?: string;
  sourceBranch: string;
  targetBranch: string;
  authorId: string;
  isDraft?: boolean;
  labels?: string[];
}

export interface UpdatePRInput {
  title?: string;
  body?: string;
  state?: PRState;
  targetBranch?: string;
  isDraft?: boolean;
  labels?: string[];
}

export interface PRListOptions {
  state?: PRState | 'all';
  authorId?: string;
  limit?: number;
  offset?: number;
}

export interface PRWithDetails extends PullRequest {
  author: { id: string; username: string; displayName: string | null };
  repository: { id: string; slug: string; name: string };
  reviewCount: number;
  commentCount: number;
}

// ============================================================================
// PR Management
// ============================================================================

/**
 * Get next PR number for a repository
 */
async function getNextPRNumber(repositoryId: string): Promise<number> {
  const result = await db
    .select({ maxNumber: sql<number>`COALESCE(MAX(${pullRequests.number}), 0)` })
    .from(pullRequests)
    .where(eq(pullRequests.repositoryId, repositoryId));

  return (result[0]?.maxNumber || 0) + 1;
}

/**
 * Create a new pull request
 */
export async function createPullRequest(input: CreatePRInput): Promise<PullRequest> {
  const {
    repositoryId,
    title,
    body,
    sourceBranch,
    targetBranch,
    authorId,
    isDraft = false,
    labels = [],
  } = input;

  // Verify repository exists
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
    with: {
      organization: true,
      owner: true,
    },
  });

  if (!repo) {
    throw new NotFoundError('Repository not found');
  }

  // Validate branches exist
  const ownerSlug = repo.organization?.slug || repo.owner?.username;
  if (!ownerSlug) {
    throw new ValidationError('Repository has no owner');
  }

  // Get the next PR number
  const prNumber = await getNextPRNumber(repositoryId);

  // Get current branch SHAs
  let sourceSha: string | undefined;
  let targetSha: string | undefined;

  try {
    const sourceRef = await gitBackend.getRefs(ownerSlug, repo.slug);
    const sourceRefData = sourceRef.find(r => r.name === sourceBranch);
    const targetRefData = sourceRef.find(r => r.name === targetBranch);
    sourceSha = sourceRefData?.sha;
    targetSha = targetRefData?.sha;
  } catch (error) {
    // Refs may not exist yet, continue without SHA
  }

  // Create the PR
  const [pr] = await db.insert(pullRequests).values({
    repositoryId,
    number: prNumber,
    title,
    body,
    sourceBranch,
    targetBranch,
    sourceSha,
    targetSha,
    authorId,
    isDraft,
    labels,
    state: isDraft ? 'draft' : 'open',
  }).returning();

  // Update repository PR count
  await db.update(repositories)
    .set({
      openPrCount: sql`${repositories.openPrCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repositoryId));

  // Trigger webhook
  triggerEvent(repositoryId, 'pull_request', {
    action: 'opened',
    pull_request: pr,
    repository: { id: repositoryId },
    sender: { id: authorId },
  }).catch(err => logger.error('api', 'Webhook trigger failed', err));

  return pr;
}

/**
 * Get pull request by ID
 */
export async function getPullRequest(id: string): Promise<PRWithDetails | null> {
  const pr = await db.query.pullRequests.findFirst({
    where: eq(pullRequests.id, id),
    with: {
      author: true,
      repository: true,
      reviews: true,
      comments: true,
    },
  });

  if (!pr) {
    return null;
  }

  return {
    ...pr,
    author: {
      id: pr.author.id,
      username: pr.author.username,
      displayName: pr.author.displayName,
    },
    repository: {
      id: pr.repository.id,
      slug: pr.repository.slug,
      name: pr.repository.name,
    },
    reviewCount: pr.reviews.length,
    commentCount: pr.comments.length,
  };
}

/**
 * Get pull request by repository and number
 */
export async function getPullRequestByNumber(
  repositoryId: string,
  number: number
): Promise<PRWithDetails | null> {
  const pr = await db.query.pullRequests.findFirst({
    where: and(
      eq(pullRequests.repositoryId, repositoryId),
      eq(pullRequests.number, number)
    ),
    with: {
      author: true,
      repository: true,
      reviews: true,
      comments: true,
    },
  });

  if (!pr) {
    return null;
  }

  return {
    ...pr,
    author: {
      id: pr.author.id,
      username: pr.author.username,
      displayName: pr.author.displayName,
    },
    repository: {
      id: pr.repository.id,
      slug: pr.repository.slug,
      name: pr.repository.name,
    },
    reviewCount: pr.reviews.length,
    commentCount: pr.comments.length,
  };
}

/**
 * List pull requests for a repository
 */
export async function listPullRequests(
  repositoryId: string,
  options: PRListOptions = {}
): Promise<{ pullRequests: PRWithDetails[]; total: number }> {
  const { state = 'open', authorId, limit = 30, offset = 0 } = options;

  const conditions = [eq(pullRequests.repositoryId, repositoryId)];

  if (state !== 'all') {
    conditions.push(eq(pullRequests.state, state));
  }

  if (authorId) {
    conditions.push(eq(pullRequests.authorId, authorId));
  }

  const prs = await db.query.pullRequests.findMany({
    where: and(...conditions),
    with: {
      author: true,
      repository: true,
      reviews: true,
      comments: true,
    },
    orderBy: desc(pullRequests.createdAt),
    limit,
    offset,
  });

  const [countResult] = await db
    .select({ count: count() })
    .from(pullRequests)
    .where(and(...conditions));

  const total = countResult?.count || 0;

  return {
    pullRequests: prs.map(pr => ({
      ...pr,
      author: {
        id: pr.author.id,
        username: pr.author.username,
        displayName: pr.author.displayName,
      },
      repository: {
        id: pr.repository.id,
        slug: pr.repository.slug,
        name: pr.repository.name,
      },
      reviewCount: pr.reviews.length,
      commentCount: pr.comments.length,
    })),
    total,
  };
}

/**
 * Update a pull request
 */
export async function updatePullRequest(
  id: string,
  input: UpdatePRInput,
  userId: string
): Promise<PullRequest> {
  const pr = await db.query.pullRequests.findFirst({
    where: eq(pullRequests.id, id),
  });

  if (!pr) {
    throw new NotFoundError('Pull request not found');
  }

  // Check authorization (author or repo admin)
  if (pr.authorId !== userId) {
    // TODO: Check if user is repo admin
    throw new ForbiddenError('Not authorized to update this pull request');
  }

  const updateData: Partial<PullRequest> = {
    updatedAt: new Date(),
  };

  if (input.title !== undefined) updateData.title = input.title;
  if (input.body !== undefined) updateData.body = input.body;
  if (input.targetBranch !== undefined) updateData.targetBranch = input.targetBranch;
  if (input.isDraft !== undefined) {
    updateData.isDraft = input.isDraft;
    // If converting from draft to ready, change state
    if (!input.isDraft && pr.state === 'draft') {
      updateData.state = 'open';
    }
  }
  if (input.labels !== undefined) updateData.labels = input.labels;

  // Handle state changes
  if (input.state !== undefined && input.state !== pr.state) {
    updateData.state = input.state;

    if (input.state === 'closed' || input.state === 'merged') {
      updateData.closedAt = new Date();

      // Decrement open PR count
      await db.update(repositories)
        .set({
          openPrCount: sql`GREATEST(${repositories.openPrCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(repositories.id, pr.repositoryId));
    }
  }

  const [updated] = await db.update(pullRequests)
    .set(updateData)
    .where(eq(pullRequests.id, id))
    .returning();

  // Trigger webhook for state changes
  if (input.state !== undefined && input.state !== pr.state) {
    const action = input.state === 'closed' ? 'closed' : 'reopened';
    triggerEvent(pr.repositoryId, 'pull_request', {
      action,
      pull_request: updated,
      repository: { id: pr.repositoryId },
      sender: { id: userId },
    }).catch(err => logger.error('api', 'Webhook trigger failed', err));
  }

  return updated;
}

/**
 * Merge a pull request
 */
export async function mergePullRequest(
  id: string,
  userId: string,
  mergeMethod: 'merge' | 'squash' | 'rebase' = 'merge'
): Promise<PullRequest> {
  const pr = await db.query.pullRequests.findFirst({
    where: eq(pullRequests.id, id),
    with: {
      repository: {
        with: {
          organization: true,
          owner: true,
        },
      },
      reviews: true,
    },
  });

  if (!pr) {
    throw new NotFoundError('Pull request not found');
  }

  if (pr.state !== 'open') {
    throw new ValidationError(`Cannot merge a ${pr.state} pull request`);
  }

  // Check for required reviews (basic check)
  const approvedReviews = pr.reviews.filter(r => r.state === 'approved');
  if (pr.requiredReviewers && approvedReviews.length < pr.requiredReviewers) {
    throw new ValidationError(`Requires ${pr.requiredReviewers} approvals, has ${approvedReviews.length}`);
  }

  // Perform the git merge
  const ownerSlug = pr.repository.organization?.slug || pr.repository.owner?.username;
  if (!ownerSlug) {
    throw new ValidationError('Repository has no owner');
  }

  // Check if merge is possible (no conflicts)
  const mergeCheck = await gitBackend.canMergeBranches(
    ownerSlug,
    pr.repository.slug,
    pr.sourceBranch,
    pr.targetBranch
  );

  if (!mergeCheck.canMerge) {
    throw new ValidationError(
      `Cannot merge: ${mergeCheck.conflicts?.join(', ') || 'Merge conflict detected'}`
    );
  }

  // Get merge commit author info
  const author = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  // Generate merge commit message
  const mergeCommitMessage = `Merge pull request #${pr.number} from ${pr.sourceBranch}\n\n${pr.title}`;

  // Perform the actual git merge
  const mergeResult = await gitBackend.mergeBranches(
    ownerSlug,
    pr.repository.slug,
    pr.sourceBranch,
    pr.targetBranch,
    mergeMethod,
    mergeCommitMessage,
    author ? { name: author.displayName || author.username, email: author.email } : undefined
  );

  if (!mergeResult.success) {
    throw new ValidationError(`Merge failed: ${mergeResult.error || 'Unknown error'}`);
  }

  const [updated] = await db.update(pullRequests)
    .set({
      state: 'merged',
      mergedAt: new Date(),
      mergedBy: userId,
      mergeCommitSha: mergeResult.commitHash,
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(pullRequests.id, id))
    .returning();

  // Decrement open PR count
  await db.update(repositories)
    .set({
      openPrCount: sql`GREATEST(${repositories.openPrCount} - 1, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, pr.repositoryId));

  // Trigger webhook
  triggerEvent(pr.repositoryId, 'pull_request', {
    action: 'merged',
    pull_request: updated,
    repository: { id: pr.repositoryId },
    sender: { id: userId },
  }).catch(err => logger.error('api', 'Webhook trigger failed', err));

  // Notify PR author
  notifyPRMerged(pr.authorId, userId, pr.title, pr.id);

  return updated;
}

/**
 * Close a pull request without merging
 */
export async function closePullRequest(id: string, userId: string): Promise<PullRequest> {
  return updatePullRequest(id, { state: 'closed' }, userId);
}

/**
 * Reopen a closed pull request
 */
export async function reopenPullRequest(id: string, userId: string): Promise<PullRequest> {
  const pr = await db.query.pullRequests.findFirst({
    where: eq(pullRequests.id, id),
  });

  if (!pr) {
    throw new NotFoundError('Pull request not found');
  }

  if (pr.state !== 'closed') {
    throw new ValidationError('Can only reopen closed pull requests');
  }

  const [updated] = await db.update(pullRequests)
    .set({
      state: 'open',
      closedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(pullRequests.id, id))
    .returning();

  // Increment open PR count
  await db.update(repositories)
    .set({
      openPrCount: sql`${repositories.openPrCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, pr.repositoryId));

  return updated;
}

// ============================================================================
// Reviews
// ============================================================================

/**
 * Create or update a review
 */
export async function submitReview(
  pullRequestId: string,
  reviewerId: string,
  state: ReviewState,
  body?: string
): Promise<PullRequestReview> {
  const pr = await db.query.pullRequests.findFirst({
    where: eq(pullRequests.id, pullRequestId),
  });

  if (!pr) {
    throw new NotFoundError('Pull request not found');
  }

  // Check if reviewer already has a pending review
  const existingReview = await db.query.pullRequestReviews.findFirst({
    where: and(
      eq(pullRequestReviews.pullRequestId, pullRequestId),
      eq(pullRequestReviews.reviewerId, reviewerId),
      eq(pullRequestReviews.state, 'pending')
    ),
  });

  if (existingReview) {
    // Update existing review
    const [updated] = await db.update(pullRequestReviews)
      .set({
        state,
        body,
        commitSha: pr.sourceSha,
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pullRequestReviews.id, existingReview.id))
      .returning();

    return updated;
  }

  // Create new review
  const [review] = await db.insert(pullRequestReviews).values({
    pullRequestId,
    reviewerId,
    state,
    body,
    commitSha: pr.sourceSha,
    submittedAt: state !== 'pending' ? new Date() : null,
  }).returning();

  // Notify PR author about the review
  if (state !== 'pending') {
    notifyPRReview(pr.authorId, reviewerId, pr.title, pr.id, state);
  }

  return review;
}

/**
 * Get reviews for a pull request
 */
export async function getReviews(pullRequestId: string): Promise<PullRequestReview[]> {
  return db.query.pullRequestReviews.findMany({
    where: eq(pullRequestReviews.pullRequestId, pullRequestId),
    with: {
      reviewer: true,
    },
    orderBy: desc(pullRequestReviews.submittedAt),
  });
}

/**
 * Dismiss a review
 */
export async function dismissReview(
  reviewId: string,
  userId: string
): Promise<PullRequestReview> {
  // TODO: Check if user has permission to dismiss (repo admin or PR author)

  const [updated] = await db.update(pullRequestReviews)
    .set({
      state: 'dismissed',
      updatedAt: new Date(),
    })
    .where(eq(pullRequestReviews.id, reviewId))
    .returning();

  if (!updated) {
    throw new NotFoundError('Review not found');
  }

  return updated;
}

// ============================================================================
// Diff/Changes
// ============================================================================

/**
 * Get diff for a pull request
 */
export async function getPullRequestDiff(
  repositoryId: string,
  prNumber: number
): Promise<any> {
  const pr = await getPullRequestByNumber(repositoryId, prNumber);

  if (!pr) {
    throw new NotFoundError('Pull request not found');
  }

  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
    with: {
      organization: true,
      owner: true,
    },
  });

  if (!repo) {
    throw new NotFoundError('Repository not found');
  }

  const ownerSlug = repo.organization?.slug || repo.owner?.username;
  if (!ownerSlug) {
    throw new ValidationError('Repository has no owner');
  }

  try {
    const diff = await gitBackend.getDiff(
      ownerSlug,
      repo.slug,
      pr.targetBranch,
      pr.sourceBranch
    );
    return diff;
  } catch (error) {
    throw new ValidationError('Could not generate diff');
  }
}

// ============================================================================
// User's Pull Requests
// ============================================================================

/**
 * Get all PRs authored by a user
 */
export async function getUserPullRequests(
  userId: string,
  options: { state?: PRState | 'all'; limit?: number; offset?: number } = {}
): Promise<PRWithDetails[]> {
  const { state = 'all', limit = 30, offset = 0 } = options;

  const conditions = [eq(pullRequests.authorId, userId)];

  if (state !== 'all') {
    conditions.push(eq(pullRequests.state, state));
  }

  const prs = await db.query.pullRequests.findMany({
    where: and(...conditions),
    with: {
      author: true,
      repository: true,
      reviews: true,
      comments: true,
    },
    orderBy: desc(pullRequests.updatedAt),
    limit,
    offset,
  });

  return prs.map(pr => ({
    ...pr,
    author: {
      id: pr.author.id,
      username: pr.author.username,
      displayName: pr.author.displayName,
    },
    repository: {
      id: pr.repository.id,
      slug: pr.repository.slug,
      name: pr.repository.name,
    },
    reviewCount: pr.reviews.length,
    commentCount: pr.comments.length,
  }));
}

/**
 * Get PRs that need review from a user
 */
export async function getUserReviewRequests(
  userId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<PRWithDetails[]> {
  const { limit = 30, offset = 0 } = options;

  // Find PRs where user has a pending review
  const pendingReviews = await db.query.pullRequestReviews.findMany({
    where: and(
      eq(pullRequestReviews.reviewerId, userId),
      eq(pullRequestReviews.state, 'pending')
    ),
  });

  if (pendingReviews.length === 0) {
    return [];
  }

  const prIds = pendingReviews.map(r => r.pullRequestId);

  const prs = await db.query.pullRequests.findMany({
    where: and(
      inArray(pullRequests.id, prIds),
      eq(pullRequests.state, 'open')
    ),
    with: {
      author: true,
      repository: true,
      reviews: true,
      comments: true,
    },
    orderBy: desc(pullRequests.updatedAt),
    limit,
    offset,
  });

  return prs.map(pr => ({
    ...pr,
    author: {
      id: pr.author.id,
      username: pr.author.username,
      displayName: pr.author.displayName,
    },
    repository: {
      id: pr.repository.id,
      slug: pr.repository.slug,
      name: pr.repository.name,
    },
    reviewCount: pr.reviews.length,
    commentCount: pr.comments.length,
  }));
}
