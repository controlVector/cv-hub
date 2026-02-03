import { describe, it, expect, beforeEach } from 'vitest';
import {
  createNotification,
  createBulkNotifications,
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  getPreferences,
  updatePreference,
  updatePreferences,
} from './notification.service';
import { getTestDb, truncateAllTables } from '../test/test-db';
import { users, notificationPreferences } from '../db/schema';
import { eq } from 'drizzle-orm';

async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const db = getTestDb();
  const [user] = await db.insert(users).values({
    username: `testuser_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    email: `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`,
    displayName: 'Test User',
    emailVerified: true,
    ...overrides,
  }).returning();
  return user;
}

describe('NotificationService', () => {
  let user: typeof users.$inferSelect;
  let actor: typeof users.$inferSelect;

  beforeEach(async () => {
    await truncateAllTables();
    user = await createTestUser({ username: 'recipient', email: 'recipient@example.com' });
    actor = await createTestUser({ username: 'actor', email: 'actor@example.com' });
  });

  describe('createNotification', () => {
    it('creates a notification for a user', async () => {
      const notification = await createNotification({
        userId: user.id,
        type: 'pr_review',
        title: 'Your PR was reviewed',
        body: 'Fix login bug',
        actorId: actor.id,
      });

      expect(notification).not.toBeNull();
      expect(notification!.userId).toBe(user.id);
      expect(notification!.type).toBe('pr_review');
      expect(notification!.title).toBe('Your PR was reviewed');
      expect(notification!.body).toBe('Fix login bug');
      expect(notification!.readAt).toBeNull();
    });

    it('returns null when actor notifies themselves', async () => {
      const notification = await createNotification({
        userId: user.id,
        type: 'pr_review',
        title: 'Self notification',
        actorId: user.id, // same as userId
      });

      expect(notification).toBeNull();
    });

    it('skips notification when user has disabled the type', async () => {
      const db = getTestDb();
      await db.insert(notificationPreferences).values({
        userId: user.id,
        type: 'pr_review',
        enabled: false,
        emailEnabled: false,
      });

      const notification = await createNotification({
        userId: user.id,
        type: 'pr_review',
        title: 'Should be skipped',
        actorId: actor.id,
      });

      expect(notification).toBeNull();
    });

    it('creates notification when preference is enabled', async () => {
      const db = getTestDb();
      await db.insert(notificationPreferences).values({
        userId: user.id,
        type: 'pr_review',
        enabled: true,
        emailEnabled: true,
      });

      const notification = await createNotification({
        userId: user.id,
        type: 'pr_review',
        title: 'Should be created',
        actorId: actor.id,
      });

      expect(notification).not.toBeNull();
    });

    it('includes related entity info', async () => {
      const notification = await createNotification({
        userId: user.id,
        type: 'issue_assigned',
        title: 'You were assigned',
        relatedEntityType: 'issue',
        relatedEntityId: '00000000-0000-0000-0000-000000000001',
        actorId: actor.id,
      });

      expect(notification!.relatedEntityType).toBe('issue');
      expect(notification!.relatedEntityId).toBe('00000000-0000-0000-0000-000000000001');
    });
  });

  describe('createBulkNotifications', () => {
    it('creates notifications for multiple users', async () => {
      const user2 = await createTestUser();
      const user3 = await createTestUser();

      await createBulkNotifications(
        [user.id, user2.id, user3.id],
        'pr_merged',
        'PR was merged',
        'Fix login',
        'pull_request',
        '00000000-0000-0000-0000-000000000001',
        actor.id
      );

      const result1 = await getNotifications(user.id);
      const result2 = await getNotifications(user2.id);
      const result3 = await getNotifications(user3.id);

      expect(result1.total).toBe(1);
      expect(result2.total).toBe(1);
      expect(result3.total).toBe(1);
    });

    it('excludes the actor from recipients', async () => {
      await createBulkNotifications(
        [user.id, actor.id],
        'pr_merged',
        'PR was merged',
        undefined,
        undefined,
        undefined,
        actor.id
      );

      const actorNotifs = await getNotifications(actor.id);
      const userNotifs = await getNotifications(user.id);

      expect(actorNotifs.total).toBe(0);
      expect(userNotifs.total).toBe(1);
    });

    it('respects disabled preferences in bulk', async () => {
      const db = getTestDb();
      await db.insert(notificationPreferences).values({
        userId: user.id,
        type: 'pr_merged',
        enabled: false,
        emailEnabled: false,
      });

      const user2 = await createTestUser();

      await createBulkNotifications(
        [user.id, user2.id],
        'pr_merged',
        'PR was merged'
      );

      const result1 = await getNotifications(user.id);
      const result2 = await getNotifications(user2.id);

      expect(result1.total).toBe(0); // disabled
      expect(result2.total).toBe(1); // no preference = enabled
    });
  });

  describe('getNotifications', () => {
    beforeEach(async () => {
      await createNotification({
        userId: user.id,
        type: 'pr_review',
        title: 'Review 1',
        actorId: actor.id,
      });
      await createNotification({
        userId: user.id,
        type: 'pr_merged',
        title: 'Merged 1',
        actorId: actor.id,
      });
      await createNotification({
        userId: user.id,
        type: 'issue_assigned',
        title: 'Assigned 1',
        actorId: actor.id,
      });
    });

    it('returns all notifications for a user', async () => {
      const result = await getNotifications(user.id);

      expect(result.notifications).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('filters by unread only', async () => {
      // Mark one as read
      const all = await getNotifications(user.id);
      await markRead(all.notifications[0].id, user.id);

      const unread = await getNotifications(user.id, { unreadOnly: true });
      expect(unread.total).toBe(2);
    });

    it('filters by type', async () => {
      const result = await getNotifications(user.id, { type: 'pr_review' });
      expect(result.total).toBe(1);
      expect(result.notifications[0].type).toBe('pr_review');
    });

    it('paginates results', async () => {
      const page1 = await getNotifications(user.id, { limit: 2, offset: 0 });
      const page2 = await getNotifications(user.id, { limit: 2, offset: 2 });

      expect(page1.notifications).toHaveLength(2);
      expect(page1.total).toBe(3);
      expect(page2.notifications).toHaveLength(1);
    });

    it('includes actor info', async () => {
      const result = await getNotifications(user.id);
      const notification = result.notifications[0] as any;
      expect(notification.actor).toBeDefined();
      expect(notification.actor.username).toBe('actor');
    });
  });

  describe('getUnreadCount', () => {
    it('returns count of unread notifications', async () => {
      await createNotification({
        userId: user.id, type: 'pr_review', title: 'n1', actorId: actor.id,
      });
      await createNotification({
        userId: user.id, type: 'pr_merged', title: 'n2', actorId: actor.id,
      });

      const count = await getUnreadCount(user.id);
      expect(count).toBe(2);
    });

    it('returns 0 when all are read', async () => {
      await createNotification({
        userId: user.id, type: 'pr_review', title: 'n1', actorId: actor.id,
      });
      await markAllRead(user.id);

      const count = await getUnreadCount(user.id);
      expect(count).toBe(0);
    });
  });

  describe('markRead', () => {
    it('marks a notification as read', async () => {
      const n = await createNotification({
        userId: user.id, type: 'pr_review', title: 'test', actorId: actor.id,
      });

      const updated = await markRead(n!.id, user.id);
      expect(updated.readAt).not.toBeNull();
    });

    it('throws NotFoundError for non-existent notification', async () => {
      await expect(
        markRead('00000000-0000-0000-0000-000000000000', user.id)
      ).rejects.toThrow();
    });

    it('throws NotFoundError when notification belongs to another user', async () => {
      const otherUser = await createTestUser();
      const n = await createNotification({
        userId: user.id, type: 'pr_review', title: 'test', actorId: actor.id,
      });

      await expect(
        markRead(n!.id, otherUser.id)
      ).rejects.toThrow();
    });
  });

  describe('markAllRead', () => {
    it('marks all unread notifications as read', async () => {
      await createNotification({
        userId: user.id, type: 'pr_review', title: 'n1', actorId: actor.id,
      });
      await createNotification({
        userId: user.id, type: 'pr_merged', title: 'n2', actorId: actor.id,
      });

      const count = await markAllRead(user.id);
      expect(count).toBe(2);

      const unread = await getUnreadCount(user.id);
      expect(unread).toBe(0);
    });

    it('returns 0 when no unread notifications exist', async () => {
      const count = await markAllRead(user.id);
      expect(count).toBe(0);
    });
  });

  describe('preferences', () => {
    describe('getPreferences', () => {
      it('returns empty array for user with no preferences', async () => {
        const prefs = await getPreferences(user.id);
        expect(prefs).toHaveLength(0);
      });

      it('returns saved preferences', async () => {
        await updatePreference(user.id, 'pr_review', true, false);
        await updatePreference(user.id, 'pr_merged', false, false);

        const prefs = await getPreferences(user.id);
        expect(prefs).toHaveLength(2);
      });
    });

    describe('updatePreference', () => {
      it('creates a new preference', async () => {
        const pref = await updatePreference(user.id, 'pr_review', true, true);

        expect(pref.userId).toBe(user.id);
        expect(pref.type).toBe('pr_review');
        expect(pref.enabled).toBe(true);
        expect(pref.emailEnabled).toBe(true);
      });

      it('updates an existing preference', async () => {
        await updatePreference(user.id, 'pr_review', true, true);
        const updated = await updatePreference(user.id, 'pr_review', false, false);

        expect(updated.enabled).toBe(false);
        expect(updated.emailEnabled).toBe(false);

        // Verify only one record exists
        const prefs = await getPreferences(user.id);
        expect(prefs).toHaveLength(1);
      });
    });

    describe('updatePreferences (bulk)', () => {
      it('updates multiple preferences at once', async () => {
        const results = await updatePreferences(user.id, [
          { type: 'pr_review', enabled: true, emailEnabled: false },
          { type: 'pr_merged', enabled: false, emailEnabled: false },
          { type: 'mention', enabled: true, emailEnabled: true },
        ]);

        expect(results).toHaveLength(3);

        const prefs = await getPreferences(user.id);
        expect(prefs).toHaveLength(3);
      });
    });
  });
});
