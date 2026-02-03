/**
 * Notification Routes
 * User notification management and preferences
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import * as notificationService from '../services/notification.service';
import { NotFoundError } from '../utils/errors';
import type { AppEnv } from '../app';

const notificationRoutes = new Hono<AppEnv>();

// ============================================================================
// Notification Endpoints
// ============================================================================

/**
 * GET /notifications
 * List notifications for the current user
 */
const listSchema = z.object({
  unread_only: z.enum(['true', 'false']).optional(),
  type: z.enum([
    'pr_review', 'pr_merged', 'pr_comment',
    'issue_assigned', 'issue_comment',
    'mention', 'repo_push', 'release',
  ]).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
});

notificationRoutes.get(
  '/notifications',
  requireAuth,
  zValidator('query', listSchema),
  async (c) => {
    const userId = c.get('userId')!;
    const { unread_only, type, limit, offset } = c.req.valid('query');

    const result = await notificationService.getNotifications(userId, {
      unreadOnly: unread_only === 'true',
      type: type as any,
      limit,
      offset,
    });

    return c.json({
      notifications: result.notifications,
      total: result.total,
    });
  }
);

/**
 * GET /notifications/unread-count
 * Get unread notification count
 */
notificationRoutes.get(
  '/notifications/unread-count',
  requireAuth,
  async (c) => {
    const userId = c.get('userId')!;
    const count = await notificationService.getUnreadCount(userId);
    return c.json({ count });
  }
);

/**
 * PATCH /notifications/:id/read
 * Mark a notification as read
 */
notificationRoutes.patch(
  '/notifications/:id/read',
  requireAuth,
  async (c) => {
    const userId = c.get('userId')!;
    const { id } = c.req.param();

    try {
      const notification = await notificationService.markRead(id, userId);
      return c.json({ notification });
    } catch (error: any) {
      if (error instanceof NotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  }
);

/**
 * POST /notifications/mark-all-read
 * Mark all notifications as read
 */
notificationRoutes.post(
  '/notifications/mark-all-read',
  requireAuth,
  async (c) => {
    const userId = c.get('userId')!;
    const count = await notificationService.markAllRead(userId);
    return c.json({ marked: count });
  }
);

// ============================================================================
// Preference Endpoints
// ============================================================================

/**
 * GET /notifications/preferences
 * Get notification preferences
 */
notificationRoutes.get(
  '/notifications/preferences',
  requireAuth,
  async (c) => {
    const userId = c.get('userId')!;
    const preferences = await notificationService.getPreferences(userId);
    return c.json({ preferences });
  }
);

/**
 * PUT /notifications/preferences
 * Update notification preferences
 */
const updatePrefsSchema = z.object({
  preferences: z.array(z.object({
    type: z.enum([
      'pr_review', 'pr_merged', 'pr_comment',
      'issue_assigned', 'issue_comment',
      'mention', 'repo_push', 'release',
    ]),
    enabled: z.boolean(),
    email_enabled: z.boolean(),
  })).min(1),
});

notificationRoutes.put(
  '/notifications/preferences',
  requireAuth,
  zValidator('json', updatePrefsSchema),
  async (c) => {
    const userId = c.get('userId')!;
    const { preferences } = c.req.valid('json');

    const updated = await notificationService.updatePreferences(
      userId,
      preferences.map(p => ({
        type: p.type,
        enabled: p.enabled,
        emailEnabled: p.email_enabled,
      }))
    );

    return c.json({ preferences: updated });
  }
);

export { notificationRoutes };
