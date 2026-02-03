/**
 * Issue Service
 * Manages issue CRUD and tracking operations
 */

import { db } from '../db';
import {
  issues,
  comments,
  repositories,
  users,
  type Issue,
  type NewIssue,
  type IssueState,
  type IssuePriority,
} from '../db/schema';
import { eq, and, desc, sql, count, or, ilike, inArray } from 'drizzle-orm';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { triggerEvent } from './webhook.service';
import { notifyIssueAssigned } from './notification.service';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface CreateIssueInput {
  repositoryId: string;
  title: string;
  body?: string;
  authorId: string;
  priority?: IssuePriority;
  labels?: string[];
  assigneeIds?: string[];
  milestone?: string;
}

export interface UpdateIssueInput {
  title?: string;
  body?: string;
  state?: IssueState;
  priority?: IssuePriority;
  labels?: string[];
  assigneeIds?: string[];
  milestone?: string | null;
}

export interface IssueListOptions {
  state?: IssueState | 'all';
  authorId?: string;
  assigneeId?: string;
  priority?: IssuePriority;
  labels?: string[];
  milestone?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface IssueWithDetails extends Issue {
  author: { id: string; username: string; displayName: string | null };
  repository: { id: string; slug: string; name: string };
  commentCount: number;
}

// ============================================================================
// Issue Management
// ============================================================================

/**
 * Get next issue number for a repository
 */
async function getNextIssueNumber(repositoryId: string): Promise<number> {
  const result = await db
    .select({ maxNumber: sql<number>`COALESCE(MAX(${issues.number}), 0)` })
    .from(issues)
    .where(eq(issues.repositoryId, repositoryId));

  return (result[0]?.maxNumber || 0) + 1;
}

/**
 * Create a new issue
 */
export async function createIssue(input: CreateIssueInput): Promise<Issue> {
  const {
    repositoryId,
    title,
    body,
    authorId,
    priority = 'medium',
    labels = [],
    assigneeIds = [],
    milestone,
  } = input;

  // Verify repository exists
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
  });

  if (!repo) {
    throw new NotFoundError('Repository not found');
  }

  if (!repo.hasIssues) {
    throw new ValidationError('Issues are disabled for this repository');
  }

  // Get the next issue number
  const issueNumber = await getNextIssueNumber(repositoryId);

  // Create the issue
  const [issue] = await db.insert(issues).values({
    repositoryId,
    number: issueNumber,
    title,
    body,
    authorId,
    priority,
    labels,
    assigneeIds,
    milestone,
    state: 'open',
  }).returning();

  // Update repository issue count
  await db.update(repositories)
    .set({
      openIssueCount: sql`${repositories.openIssueCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repositoryId));

  // Trigger webhook
  triggerEvent(repositoryId, 'issues', {
    action: 'opened',
    issue,
    repository: { id: repositoryId },
    sender: { id: authorId },
  }).catch(err => logger.error('api', 'Webhook trigger failed', err));

  return issue;
}

/**
 * Get issue by ID
 */
export async function getIssue(id: string): Promise<IssueWithDetails | null> {
  const issue = await db.query.issues.findFirst({
    where: eq(issues.id, id),
    with: {
      author: true,
      repository: true,
      comments: true,
    },
  });

  if (!issue) {
    return null;
  }

  return {
    ...issue,
    author: {
      id: issue.author.id,
      username: issue.author.username,
      displayName: issue.author.displayName,
    },
    repository: {
      id: issue.repository.id,
      slug: issue.repository.slug,
      name: issue.repository.name,
    },
    commentCount: issue.comments.length,
  };
}

/**
 * Get issue by repository and number
 */
export async function getIssueByNumber(
  repositoryId: string,
  number: number
): Promise<IssueWithDetails | null> {
  const issue = await db.query.issues.findFirst({
    where: and(
      eq(issues.repositoryId, repositoryId),
      eq(issues.number, number)
    ),
    with: {
      author: true,
      repository: true,
      comments: true,
    },
  });

  if (!issue) {
    return null;
  }

  return {
    ...issue,
    author: {
      id: issue.author.id,
      username: issue.author.username,
      displayName: issue.author.displayName,
    },
    repository: {
      id: issue.repository.id,
      slug: issue.repository.slug,
      name: issue.repository.name,
    },
    commentCount: issue.comments.length,
  };
}

/**
 * List issues for a repository
 */
export async function listIssues(
  repositoryId: string,
  options: IssueListOptions = {}
): Promise<{ issues: IssueWithDetails[]; total: number }> {
  const {
    state = 'open',
    authorId,
    assigneeId,
    priority,
    labels,
    milestone,
    search,
    limit = 30,
    offset = 0,
  } = options;

  const conditions = [eq(issues.repositoryId, repositoryId)];

  if (state !== 'all') {
    conditions.push(eq(issues.state, state));
  }

  if (authorId) {
    conditions.push(eq(issues.authorId, authorId));
  }

  if (priority) {
    conditions.push(eq(issues.priority, priority));
  }

  if (milestone) {
    conditions.push(eq(issues.milestone, milestone));
  }

  if (search) {
    conditions.push(
      or(
        ilike(issues.title, `%${search}%`),
        ilike(issues.body, `%${search}%`)
      )!
    );
  }

  // Note: assigneeId and labels filtering requires JSONB operations
  // which may need raw SQL for complex filtering

  const issueList = await db.query.issues.findMany({
    where: and(...conditions),
    with: {
      author: true,
      repository: true,
      comments: true,
    },
    orderBy: desc(issues.createdAt),
    limit,
    offset,
  });

  // Filter by assignee if provided (post-query filter for JSONB)
  let filteredIssues = issueList;
  if (assigneeId) {
    filteredIssues = issueList.filter(issue =>
      issue.assigneeIds?.includes(assigneeId)
    );
  }

  // Filter by labels if provided
  if (labels && labels.length > 0) {
    filteredIssues = filteredIssues.filter(issue =>
      labels.some(label => issue.labels?.includes(label))
    );
  }

  const [countResult] = await db
    .select({ count: count() })
    .from(issues)
    .where(and(...conditions));

  const total = countResult?.count || 0;

  return {
    issues: filteredIssues.map(issue => ({
      ...issue,
      author: {
        id: issue.author.id,
        username: issue.author.username,
        displayName: issue.author.displayName,
      },
      repository: {
        id: issue.repository.id,
        slug: issue.repository.slug,
        name: issue.repository.name,
      },
      commentCount: issue.comments.length,
    })),
    total,
  };
}

/**
 * Update an issue
 */
export async function updateIssue(
  id: string,
  input: UpdateIssueInput,
  userId: string
): Promise<Issue> {
  const issue = await db.query.issues.findFirst({
    where: eq(issues.id, id),
  });

  if (!issue) {
    throw new NotFoundError('Issue not found');
  }

  // Check authorization (author or repo admin)
  // TODO: Add proper permission check
  // if (issue.authorId !== userId) {
  //   throw new ForbiddenError('Not authorized to update this issue');
  // }

  const updateData: Partial<Issue> = {
    updatedAt: new Date(),
  };

  if (input.title !== undefined) updateData.title = input.title;
  if (input.body !== undefined) updateData.body = input.body;
  if (input.priority !== undefined) updateData.priority = input.priority;
  if (input.labels !== undefined) updateData.labels = input.labels;
  if (input.assigneeIds !== undefined) updateData.assigneeIds = input.assigneeIds;
  if (input.milestone !== undefined) updateData.milestone = input.milestone;

  // Handle state changes
  if (input.state !== undefined && input.state !== issue.state) {
    updateData.state = input.state;

    if (input.state === 'closed') {
      updateData.closedAt = new Date();
      updateData.closedBy = userId;

      // Decrement open issue count
      await db.update(repositories)
        .set({
          openIssueCount: sql`GREATEST(${repositories.openIssueCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(repositories.id, issue.repositoryId));
    } else if (input.state === 'open' && issue.state === 'closed') {
      updateData.closedAt = null;
      updateData.closedBy = null;

      // Increment open issue count
      await db.update(repositories)
        .set({
          openIssueCount: sql`${repositories.openIssueCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(repositories.id, issue.repositoryId));
    }
  }

  const [updated] = await db.update(issues)
    .set(updateData)
    .where(eq(issues.id, id))
    .returning();

  // Trigger webhook
  let action = 'edited';
  if (input.state !== undefined && input.state !== issue.state) {
    action = input.state === 'closed' ? 'closed' : 'reopened';
  }
  triggerEvent(issue.repositoryId, 'issues', {
    action,
    issue: updated,
    repository: { id: issue.repositoryId },
    sender: { id: userId },
  }).catch(err => logger.error('api', 'Webhook trigger failed', err));

  // Notify newly assigned users
  if (input.assigneeIds !== undefined) {
    const oldAssignees = new Set(issue.assigneeIds || []);
    const newAssignees = input.assigneeIds.filter(id => !oldAssignees.has(id));
    for (const assigneeId of newAssignees) {
      notifyIssueAssigned(assigneeId, userId, issue.title, issue.id);
    }
  }

  return updated;
}

/**
 * Close an issue
 */
export async function closeIssue(id: string, userId: string): Promise<Issue> {
  return updateIssue(id, { state: 'closed' }, userId);
}

/**
 * Reopen an issue
 */
export async function reopenIssue(id: string, userId: string): Promise<Issue> {
  return updateIssue(id, { state: 'open' }, userId);
}

/**
 * Delete an issue
 */
export async function deleteIssue(id: string, userId: string): Promise<void> {
  const issue = await db.query.issues.findFirst({
    where: eq(issues.id, id),
  });

  if (!issue) {
    throw new NotFoundError('Issue not found');
  }

  // TODO: Check if user has admin permissions

  // Delete the issue (comments will cascade)
  await db.delete(issues).where(eq(issues.id, id));

  // Update count if issue was open
  if (issue.state === 'open') {
    await db.update(repositories)
      .set({
        openIssueCount: sql`GREATEST(${repositories.openIssueCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, issue.repositoryId));
  }
}

// ============================================================================
// Comments
// ============================================================================

/**
 * Add a comment to an issue
 */
export async function addComment(
  issueId: string,
  authorId: string,
  body: string
): Promise<typeof comments.$inferSelect> {
  const issue = await db.query.issues.findFirst({
    where: eq(issues.id, issueId),
  });

  if (!issue) {
    throw new NotFoundError('Issue not found');
  }

  const [comment] = await db.insert(comments).values({
    issueId,
    authorId,
    body,
    isInlineComment: false,
  }).returning();

  // Update issue timestamp
  await db.update(issues)
    .set({ updatedAt: new Date() })
    .where(eq(issues.id, issueId));

  return comment;
}

/**
 * Get comments for an issue
 */
export async function getComments(issueId: string): Promise<any[]> {
  return db.query.comments.findMany({
    where: eq(comments.issueId, issueId),
    with: {
      author: true,
    },
    orderBy: comments.createdAt,
  });
}

/**
 * Update a comment
 */
export async function updateComment(
  commentId: string,
  userId: string,
  body: string
): Promise<typeof comments.$inferSelect> {
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
  });

  if (!comment) {
    throw new NotFoundError('Comment not found');
  }

  if (comment.authorId !== userId) {
    throw new ForbiddenError('Not authorized to update this comment');
  }

  const [updated] = await db.update(comments)
    .set({
      body,
      isEdited: true,
      editedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(comments.id, commentId))
    .returning();

  return updated;
}

/**
 * Delete a comment
 */
export async function deleteComment(commentId: string, userId: string): Promise<void> {
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
  });

  if (!comment) {
    throw new NotFoundError('Comment not found');
  }

  if (comment.authorId !== userId) {
    // TODO: Check if user is repo admin
    throw new ForbiddenError('Not authorized to delete this comment');
  }

  await db.delete(comments).where(eq(comments.id, commentId));
}

// ============================================================================
// User's Issues
// ============================================================================

/**
 * Get all issues authored by a user
 */
export async function getUserIssues(
  userId: string,
  options: { state?: IssueState | 'all'; limit?: number; offset?: number } = {}
): Promise<IssueWithDetails[]> {
  const { state = 'all', limit = 30, offset = 0 } = options;

  const conditions = [eq(issues.authorId, userId)];

  if (state !== 'all') {
    conditions.push(eq(issues.state, state));
  }

  const issueList = await db.query.issues.findMany({
    where: and(...conditions),
    with: {
      author: true,
      repository: true,
      comments: true,
    },
    orderBy: desc(issues.updatedAt),
    limit,
    offset,
  });

  return issueList.map(issue => ({
    ...issue,
    author: {
      id: issue.author.id,
      username: issue.author.username,
      displayName: issue.author.displayName,
    },
    repository: {
      id: issue.repository.id,
      slug: issue.repository.slug,
      name: issue.repository.name,
    },
    commentCount: issue.comments.length,
  }));
}

/**
 * Get issues assigned to a user
 */
export async function getUserAssignedIssues(
  userId: string,
  options: { state?: IssueState | 'all'; limit?: number; offset?: number } = {}
): Promise<IssueWithDetails[]> {
  const { state = 'open', limit = 30, offset = 0 } = options;

  // Get all issues and filter by assignee (JSONB array contains)
  const conditions = [eq(issues.state, state === 'all' ? issues.state : state)];

  const issueList = await db.query.issues.findMany({
    where: state !== 'all' ? eq(issues.state, state) : undefined,
    with: {
      author: true,
      repository: true,
      comments: true,
    },
    orderBy: desc(issues.updatedAt),
    limit: 100, // Get more and filter
  });

  // Filter by assignee
  const assigned = issueList.filter(issue =>
    issue.assigneeIds?.includes(userId)
  );

  return assigned.slice(offset, offset + limit).map(issue => ({
    ...issue,
    author: {
      id: issue.author.id,
      username: issue.author.username,
      displayName: issue.author.displayName,
    },
    repository: {
      id: issue.repository.id,
      slug: issue.repository.slug,
      name: issue.repository.name,
    },
    commentCount: issue.comments.length,
  }));
}

// ============================================================================
// Labels
// ============================================================================

/**
 * Get all unique labels used in a repository
 */
export async function getRepositoryLabels(repositoryId: string): Promise<string[]> {
  const issueList = await db.query.issues.findMany({
    where: eq(issues.repositoryId, repositoryId),
    columns: { labels: true },
  });

  const labelSet = new Set<string>();
  for (const issue of issueList) {
    if (issue.labels) {
      for (const label of issue.labels) {
        labelSet.add(label);
      }
    }
  }

  return Array.from(labelSet).sort();
}

/**
 * Get all unique milestones used in a repository
 */
export async function getRepositoryMilestones(repositoryId: string): Promise<string[]> {
  const issueList = await db.query.issues.findMany({
    where: and(
      eq(issues.repositoryId, repositoryId),
      sql`${issues.milestone} IS NOT NULL`
    ),
    columns: { milestone: true },
  });

  const milestones = [...new Set(issueList.map(i => i.milestone).filter(Boolean))];
  return milestones as string[];
}
