/**
 * Auto-Merge Service
 * Automatically merges PRs when all required conditions are met
 */

import { db } from '../db';
import { pullRequests, repositories, branches, users } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { NotFoundError, ValidationError, ForbiddenError } from '../utils/errors';
import { mergePullRequest } from './pr.service';
import { getCombinedStatus, checkRequiredStatuses } from './commit-status.service';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface AutoMergeStatus {
  enabled: boolean;
  method: MergeMethod | null;
  enabledBy: string | null;
  enabledAt: Date | null;
}

// ============================================================================
// Enable / Disable Auto-Merge
// ============================================================================

/**
 * Enable auto-merge on a pull request
 */
export async function enableAutoMerge(
  prId: string,
  userId: string,
  mergeMethod: MergeMethod = 'merge',
): Promise<AutoMergeStatus> {
  const pr = await db.query.pullRequests.findFirst({
    where: eq(pullRequests.id, prId),
  });

  if (!pr) {
    throw new NotFoundError('Pull request not found');
  }

  if (pr.state !== 'open') {
    throw new ValidationError('Auto-merge can only be enabled on open pull requests');
  }

  if (pr.isDraft) {
    throw new ValidationError('Auto-merge cannot be enabled on draft pull requests');
  }

  if (pr.autoMergeEnabled) {
    throw new ValidationError('Auto-merge is already enabled on this pull request');
  }

  const now = new Date();

  await db.update(pullRequests)
    .set({
      autoMergeEnabled: true,
      autoMergeMethod: mergeMethod,
      autoMergeEnabledBy: userId,
      autoMergeEnabledAt: now,
      updatedAt: now,
    })
    .where(eq(pullRequests.id, prId));

  logger.info('general', 'Auto-merge enabled', { prId, userId, mergeMethod });

  return {
    enabled: true,
    method: mergeMethod,
    enabledBy: userId,
    enabledAt: now,
  };
}

/**
 * Disable auto-merge on a pull request
 */
export async function disableAutoMerge(
  prId: string,
): Promise<AutoMergeStatus> {
  const pr = await db.query.pullRequests.findFirst({
    where: eq(pullRequests.id, prId),
  });

  if (!pr) {
    throw new NotFoundError('Pull request not found');
  }

  if (!pr.autoMergeEnabled) {
    throw new ValidationError('Auto-merge is not enabled on this pull request');
  }

  await db.update(pullRequests)
    .set({
      autoMergeEnabled: false,
      autoMergeMethod: null,
      autoMergeEnabledBy: null,
      autoMergeEnabledAt: null,
      updatedAt: new Date(),
    })
    .where(eq(pullRequests.id, prId));

  logger.info('general', 'Auto-merge disabled', { prId });

  return {
    enabled: false,
    method: null,
    enabledBy: null,
    enabledAt: null,
  };
}

/**
 * Get auto-merge status for a pull request
 */
export async function getAutoMergeStatus(
  prId: string,
): Promise<AutoMergeStatus> {
  const pr = await db.query.pullRequests.findFirst({
    where: eq(pullRequests.id, prId),
  });

  if (!pr) {
    throw new NotFoundError('Pull request not found');
  }

  return {
    enabled: pr.autoMergeEnabled,
    method: pr.autoMergeMethod as MergeMethod | null,
    enabledBy: pr.autoMergeEnabledBy,
    enabledAt: pr.autoMergeEnabledAt,
  };
}

// ============================================================================
// Auto-Merge Eligibility Check
// ============================================================================

/**
 * Check if a PR is eligible for auto-merge and perform the merge if so.
 * Called when status checks update or reviews are submitted.
 * Returns true if the PR was auto-merged.
 */
export async function checkAndTriggerAutoMerge(
  prId: string,
): Promise<boolean> {
  const pr = await db.query.pullRequests.findFirst({
    where: eq(pullRequests.id, prId),
    with: {
      reviews: true,
      repository: true,
    },
  });

  if (!pr) return false;
  if (!pr.autoMergeEnabled) return false;
  if (pr.state !== 'open') return false;

  // Check required reviews
  const approvedReviews = pr.reviews.filter(r => r.state === 'approved');
  if (pr.requiredReviewers && approvedReviews.length < pr.requiredReviewers) {
    logger.info('general', 'Auto-merge: insufficient reviews', {
      prId,
      approved: approvedReviews.length,
      required: pr.requiredReviewers,
    });
    return false;
  }

  // Check branch protection status checks
  if (pr.targetSha || pr.sourceSha) {
    const sha = pr.sourceSha || pr.targetSha;
    if (sha) {
      const targetBranch = await db.query.branches.findFirst({
        where: and(
          eq(branches.repositoryId, pr.repositoryId),
          eq(branches.name, pr.targetBranch),
        ),
      });

      if (targetBranch?.isProtected && targetBranch.protectionRules) {
        const rules = targetBranch.protectionRules as any;
        if (rules.requireStatusChecks?.length > 0) {
          const statusResult = await checkRequiredStatuses(
            pr.repositoryId,
            sha,
            rules.requireStatusChecks,
          );
          if (!statusResult.passed) {
            logger.info('general', 'Auto-merge: status checks not passed', {
              prId,
              missing: statusResult.missing,
              failing: statusResult.failing,
            });
            return false;
          }
        }
      }
    }
  }

  // All checks passed - attempt merge
  try {
    const mergeMethod = (pr.autoMergeMethod as MergeMethod) || 'merge';
    await mergePullRequest(pr.id, pr.autoMergeEnabledBy || pr.authorId, mergeMethod);

    logger.info('general', 'Auto-merge: PR merged successfully', { prId });
    return true;
  } catch (err: any) {
    logger.error('general', 'Auto-merge: merge failed', { prId, error: err.message });
    return false;
  }
}

/**
 * Disable auto-merge when new commits are pushed to the PR branch.
 * This prevents auto-merging unreviewed code.
 */
export async function disableAutoMergeOnUpdate(
  repositoryId: string,
  sourceBranch: string,
): Promise<void> {
  const prs = await db.query.pullRequests.findMany({
    where: and(
      eq(pullRequests.repositoryId, repositoryId),
      eq(pullRequests.sourceBranch, sourceBranch),
      eq(pullRequests.state, 'open'),
      eq(pullRequests.autoMergeEnabled, true),
    ),
  });

  for (const pr of prs) {
    await db.update(pullRequests)
      .set({
        autoMergeEnabled: false,
        autoMergeMethod: null,
        autoMergeEnabledBy: null,
        autoMergeEnabledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(pullRequests.id, pr.id));

    logger.info('general', 'Auto-merge disabled due to new commits', { prId: pr.id });
  }
}
