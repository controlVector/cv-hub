/**
 * Commit Status Service
 * Manages commit status checks for CI/CD integration
 */

import { db } from '../db';
import {
  commitStatuses,
  repositories,
  type CommitStatus,
  type StatusCheckState,
} from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { NotFoundError, ValidationError } from '../utils/errors';

// ============================================================================
// Types
// ============================================================================

export interface CreateStatusInput {
  repositoryId: string;
  sha: string;
  state: StatusCheckState;
  context?: string;
  description?: string;
  targetUrl?: string;
  creatorId?: string;
}

export interface CombinedStatus {
  state: StatusCheckState;
  sha: string;
  totalCount: number;
  statuses: CommitStatus[];
}

// ============================================================================
// Status CRUD
// ============================================================================

/**
 * Create or update a commit status for a given context.
 * Multiple statuses per context are allowed; the latest one wins
 * when computing combined status.
 */
export async function createCommitStatus(input: CreateStatusInput): Promise<CommitStatus> {
  const {
    repositoryId,
    sha,
    state,
    context = 'default',
    description,
    targetUrl,
    creatorId,
  } = input;

  // Validate SHA format
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) {
    throw new ValidationError('Invalid commit SHA');
  }

  // Validate state
  const validStates: StatusCheckState[] = ['pending', 'success', 'failure', 'error'];
  if (!validStates.includes(state)) {
    throw new ValidationError(`Invalid state: ${state}`);
  }

  // Verify repository exists
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
  });

  if (!repo) {
    throw new NotFoundError('Repository');
  }

  const [status] = await db.insert(commitStatuses).values({
    repositoryId,
    sha,
    state,
    context,
    description,
    targetUrl,
    creatorId,
  }).returning();

  return status;
}

/**
 * Get all statuses for a commit SHA, ordered by most recent first
 */
export async function getCommitStatuses(
  repositoryId: string,
  sha: string
): Promise<CommitStatus[]> {
  return db.query.commitStatuses.findMany({
    where: and(
      eq(commitStatuses.repositoryId, repositoryId),
      eq(commitStatuses.sha, sha),
    ),
    with: {
      creator: {
        columns: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: desc(commitStatuses.createdAt),
  });
}

/**
 * Get the combined status for a commit SHA.
 * For each context, only the latest status is considered.
 * Combined state logic:
 *  - If ANY latest-per-context is 'error' -> 'error'
 *  - If ANY latest-per-context is 'failure' -> 'failure'
 *  - If ANY latest-per-context is 'pending' -> 'pending'
 *  - Otherwise -> 'success'
 */
export async function getCombinedStatus(
  repositoryId: string,
  sha: string
): Promise<CombinedStatus> {
  const allStatuses = await db.query.commitStatuses.findMany({
    where: and(
      eq(commitStatuses.repositoryId, repositoryId),
      eq(commitStatuses.sha, sha),
    ),
    with: {
      creator: {
        columns: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: desc(commitStatuses.createdAt),
  });

  // Get latest status per context
  const latestByContext = new Map<string, CommitStatus>();
  for (const status of allStatuses) {
    if (!latestByContext.has(status.context)) {
      latestByContext.set(status.context, status);
    }
  }

  const latestStatuses = Array.from(latestByContext.values());

  // Compute combined state
  let combinedState: StatusCheckState = 'success';

  if (latestStatuses.length === 0) {
    combinedState = 'pending';
  } else {
    for (const status of latestStatuses) {
      if (status.state === 'error') {
        combinedState = 'error';
        break;
      }
      if (status.state === 'failure') {
        combinedState = 'failure';
        break;
      }
      if (status.state === 'pending') {
        combinedState = 'pending';
      }
    }
  }

  return {
    state: combinedState,
    sha,
    totalCount: latestStatuses.length,
    statuses: latestStatuses,
  };
}

/**
 * Check if specific required status checks have passed for a commit.
 * Used by branch protection validation.
 */
export async function checkRequiredStatuses(
  repositoryId: string,
  sha: string,
  requiredChecks: string[]
): Promise<{ passed: boolean; missing: string[]; failing: string[] }> {
  const allStatuses = await db.query.commitStatuses.findMany({
    where: and(
      eq(commitStatuses.repositoryId, repositoryId),
      eq(commitStatuses.sha, sha),
    ),
    orderBy: desc(commitStatuses.createdAt),
  });

  // Get latest status per context
  const latestByContext = new Map<string, CommitStatus>();
  for (const status of allStatuses) {
    if (!latestByContext.has(status.context)) {
      latestByContext.set(status.context, status);
    }
  }

  const missing: string[] = [];
  const failing: string[] = [];

  for (const check of requiredChecks) {
    const status = latestByContext.get(check);
    if (!status) {
      missing.push(check);
    } else if (status.state !== 'success') {
      failing.push(`${check} (${status.state})`);
    }
  }

  return {
    passed: missing.length === 0 && failing.length === 0,
    missing,
    failing,
  };
}
