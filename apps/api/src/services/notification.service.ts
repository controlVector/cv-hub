/**
 * Notification Service
 * Manages in-app notifications and user preferences
 */

import { db } from '../db';
import {
  notifications,
  notificationPreferences,
  type Notification,
  type NotificationPreference,
  type NotificationType,
} from '../db/schema';
import { eq, and, desc, isNull, sql, count } from 'drizzle-orm';
import { NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  actorId?: string;
}

export interface NotificationListOptions {
  unreadOnly?: boolean;
  type?: NotificationType;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Notification CRUD
// ============================================================================

/**
 * Create a notification for a user.
 * Respects user preferences - skips if the type is disabled.
 * Fire-and-forget safe: catches its own errors.
 */
export async function createNotification(input: CreateNotificationInput): Promise<Notification | null> {
  const { userId, type, title, body, relatedEntityType, relatedEntityId, actorId } = input;

  // Don't notify the actor about their own action
  if (actorId && actorId === userId) {
    return null;
  }

  // Check user preferences
  const pref = await db.query.notificationPreferences.findFirst({
    where: and(
      eq(notificationPreferences.userId, userId),
      eq(notificationPreferences.type, type),
    ),
  });

  // If preference exists and is disabled, skip
  if (pref && !pref.enabled) {
    return null;
  }

  const [notification] = await db.insert(notifications).values({
    userId,
    type,
    title,
    body,
    relatedEntityType,
    relatedEntityId,
    actorId,
  }).returning();

  return notification;
}

/**
 * Create notifications for multiple users at once (e.g., watchers).
 */
export async function createBulkNotifications(
  userIds: string[],
  type: NotificationType,
  title: string,
  body?: string,
  relatedEntityType?: string,
  relatedEntityId?: string,
  actorId?: string
): Promise<void> {
  // Filter out the actor
  const recipients = actorId ? userIds.filter(id => id !== actorId) : userIds;
  if (recipients.length === 0) return;

  // Check preferences for all recipients
  const prefs = await db.query.notificationPreferences.findMany({
    where: and(
      eq(notificationPreferences.type, type),
      eq(notificationPreferences.enabled, false),
    ),
  });

  const disabledUserIds = new Set(prefs.map(p => p.userId));
  const filteredRecipients = recipients.filter(id => !disabledUserIds.has(id));
  if (filteredRecipients.length === 0) return;

  await db.insert(notifications).values(
    filteredRecipients.map(userId => ({
      userId,
      type,
      title,
      body,
      relatedEntityType,
      relatedEntityId,
      actorId,
    }))
  );
}

/**
 * Get notifications for a user
 */
export async function getNotifications(
  userId: string,
  options: NotificationListOptions = {}
): Promise<{ notifications: Notification[]; total: number }> {
  const { unreadOnly = false, type, limit = 30, offset = 0 } = options;

  const conditions = [eq(notifications.userId, userId)];

  if (unreadOnly) {
    conditions.push(isNull(notifications.readAt));
  }

  if (type) {
    conditions.push(eq(notifications.type, type));
  }

  const results = await db.query.notifications.findMany({
    where: and(...conditions),
    with: {
      actor: {
        columns: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: desc(notifications.createdAt),
    limit,
    offset,
  });

  const [countResult] = await db
    .select({ count: count() })
    .from(notifications)
    .where(and(...conditions));

  return {
    notifications: results,
    total: countResult?.count || 0,
  };
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(notifications)
    .where(and(
      eq(notifications.userId, userId),
      isNull(notifications.readAt),
    ));

  return result?.count || 0;
}

/**
 * Mark a single notification as read
 */
export async function markRead(notificationId: string, userId: string): Promise<Notification> {
  const existing = await db.query.notifications.findFirst({
    where: and(
      eq(notifications.id, notificationId),
      eq(notifications.userId, userId),
    ),
  });

  if (!existing) {
    throw new NotFoundError('Notification');
  }

  const [updated] = await db.update(notifications)
    .set({ readAt: new Date() })
    .where(eq(notifications.id, notificationId))
    .returning();

  return updated;
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllRead(userId: string): Promise<number> {
  const result = await db.update(notifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(notifications.userId, userId),
      isNull(notifications.readAt),
    ))
    .returning({ id: notifications.id });

  return result.length;
}

// ============================================================================
// Preferences
// ============================================================================

/**
 * Get notification preferences for a user.
 * Returns all types with defaults for any not yet configured.
 */
export async function getPreferences(userId: string): Promise<NotificationPreference[]> {
  return db.query.notificationPreferences.findMany({
    where: eq(notificationPreferences.userId, userId),
  });
}

/**
 * Update a notification preference
 */
export async function updatePreference(
  userId: string,
  type: NotificationType,
  enabled: boolean,
  emailEnabled: boolean
): Promise<NotificationPreference> {
  // Upsert: try update first, then insert
  const existing = await db.query.notificationPreferences.findFirst({
    where: and(
      eq(notificationPreferences.userId, userId),
      eq(notificationPreferences.type, type),
    ),
  });

  if (existing) {
    const [updated] = await db.update(notificationPreferences)
      .set({
        enabled,
        emailEnabled,
        updatedAt: new Date(),
      })
      .where(eq(notificationPreferences.id, existing.id))
      .returning();

    return updated;
  }

  const [created] = await db.insert(notificationPreferences).values({
    userId,
    type,
    enabled,
    emailEnabled,
  }).returning();

  return created;
}

/**
 * Bulk update preferences
 */
export async function updatePreferences(
  userId: string,
  prefs: Array<{ type: NotificationType; enabled: boolean; emailEnabled: boolean }>
): Promise<NotificationPreference[]> {
  const results: NotificationPreference[] = [];

  for (const pref of prefs) {
    const result = await updatePreference(userId, pref.type, pref.enabled, pref.emailEnabled);
    results.push(result);
  }

  return results;
}

// ============================================================================
// Helpers for event triggers (fire-and-forget)
// ============================================================================

/**
 * Notify a PR author about a review
 */
export function notifyPRReview(
  authorId: string,
  reviewerActorId: string,
  prTitle: string,
  prId: string,
  state: string
): void {
  const actionText = state === 'approved' ? 'approved' : state === 'changes_requested' ? 'requested changes on' : 'reviewed';
  createNotification({
    userId: authorId,
    type: 'pr_review',
    title: `Your pull request was ${actionText}`,
    body: prTitle,
    relatedEntityType: 'pull_request',
    relatedEntityId: prId,
    actorId: reviewerActorId,
  }).catch(err => logger.error('api', 'Failed to create PR review notification', err));
}

/**
 * Notify a PR author that their PR was merged
 */
export function notifyPRMerged(
  authorId: string,
  mergerActorId: string,
  prTitle: string,
  prId: string
): void {
  createNotification({
    userId: authorId,
    type: 'pr_merged',
    title: 'Your pull request was merged',
    body: prTitle,
    relatedEntityType: 'pull_request',
    relatedEntityId: prId,
    actorId: mergerActorId,
  }).catch(err => logger.error('api', 'Failed to create PR merged notification', err));
}

/**
 * Notify an issue author about assignment
 */
export function notifyIssueAssigned(
  assigneeId: string,
  assignerActorId: string,
  issueTitle: string,
  issueId: string
): void {
  createNotification({
    userId: assigneeId,
    type: 'issue_assigned',
    title: 'You were assigned to an issue',
    body: issueTitle,
    relatedEntityType: 'issue',
    relatedEntityId: issueId,
    actorId: assignerActorId,
  }).catch(err => logger.error('api', 'Failed to create issue assigned notification', err));
}
