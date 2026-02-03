import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  createWebhook,
  updateWebhook,
  deleteWebhook,
  listWebhooks,
  getWebhook,
  triggerEvent,
  getDeliveries,
} from './webhook.service';
import { getTestDb, truncateAllTables } from '../test/test-db';
import { users, repositories, webhooks, webhookDeliveries } from '../db/schema';
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

async function createTestRepo(userId: string) {
  const db = getTestDb();
  const slug = `test-repo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [repo] = await db.insert(repositories).values({
    userId,
    name: slug,
    slug,
    visibility: 'public',
    provider: 'local',
  }).returning();
  return repo;
}

describe('WebhookService', () => {
  let user: typeof users.$inferSelect;
  let repo: typeof repositories.$inferSelect;

  beforeEach(async () => {
    await truncateAllTables();
    user = await createTestUser();
    repo = await createTestRepo(user.id);
  });

  describe('createWebhook', () => {
    it('creates a webhook with hashed secret', async () => {
      const webhook = await createWebhook({
        repositoryId: repo.id,
        url: 'https://example.com/webhook',
        secret: 'my-secret',
        events: ['push'],
        createdBy: user.id,
      });

      expect(webhook.id).toBeDefined();
      expect(webhook.repositoryId).toBe(repo.id);
      expect(webhook.url).toBe('https://example.com/webhook');
      expect(webhook.events).toEqual(['push']);
      expect(webhook.active).toBe(true);
      // Secret should be hashed, not plain text
      expect(webhook.secret).not.toBe('my-secret');
      expect(webhook.secret).toHaveLength(64); // SHA256 hex
    });

    it('creates a webhook with multiple events', async () => {
      const webhook = await createWebhook({
        repositoryId: repo.id,
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['push', 'pull_request', 'issues'],
        createdBy: user.id,
      });

      expect(webhook.events).toEqual(['push', 'pull_request', 'issues']);
    });

    it('throws ValidationError for invalid URL', async () => {
      await expect(
        createWebhook({
          repositoryId: repo.id,
          url: 'not-a-url',
          secret: 'secret',
          events: ['push'],
          createdBy: user.id,
        })
      ).rejects.toThrow('Invalid webhook URL');
    });

    it('throws ValidationError for invalid events', async () => {
      await expect(
        createWebhook({
          repositoryId: repo.id,
          url: 'https://example.com/webhook',
          secret: 'secret',
          events: ['push', 'invalid_event'],
          createdBy: user.id,
        })
      ).rejects.toThrow('Invalid events');
    });

    it('throws ValidationError for empty events', async () => {
      await expect(
        createWebhook({
          repositoryId: repo.id,
          url: 'https://example.com/webhook',
          secret: 'secret',
          events: [],
          createdBy: user.id,
        })
      ).rejects.toThrow('At least one event is required');
    });
  });

  describe('updateWebhook', () => {
    it('updates webhook URL', async () => {
      const webhook = await createWebhook({
        repositoryId: repo.id,
        url: 'https://example.com/old',
        secret: 'secret',
        events: ['push'],
        createdBy: user.id,
      });

      const updated = await updateWebhook(webhook.id, {
        url: 'https://example.com/new',
      });

      expect(updated.url).toBe('https://example.com/new');
    });

    it('re-hashes secret when updated', async () => {
      const webhook = await createWebhook({
        repositoryId: repo.id,
        url: 'https://example.com/webhook',
        secret: 'original-secret',
        events: ['push'],
        createdBy: user.id,
      });

      const originalHash = webhook.secret;

      const updated = await updateWebhook(webhook.id, {
        secret: 'new-secret',
      });

      expect(updated.secret).not.toBe(originalHash);
      expect(updated.secret).not.toBe('new-secret');
    });

    it('deactivates a webhook', async () => {
      const webhook = await createWebhook({
        repositoryId: repo.id,
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['push'],
        createdBy: user.id,
      });

      const updated = await updateWebhook(webhook.id, { active: false });
      expect(updated.active).toBe(false);
    });

    it('throws NotFoundError for non-existent webhook', async () => {
      await expect(
        updateWebhook('00000000-0000-0000-0000-000000000000', { url: 'https://new.com' })
      ).rejects.toThrow();
    });

    it('validates events on update', async () => {
      const webhook = await createWebhook({
        repositoryId: repo.id,
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['push'],
        createdBy: user.id,
      });

      await expect(
        updateWebhook(webhook.id, { events: ['invalid'] })
      ).rejects.toThrow('Invalid events');
    });
  });

  describe('deleteWebhook', () => {
    it('deletes a webhook', async () => {
      const webhook = await createWebhook({
        repositoryId: repo.id,
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['push'],
        createdBy: user.id,
      });

      await deleteWebhook(webhook.id);

      const result = await getWebhook(webhook.id);
      expect(result).toBeNull();
    });

    it('throws NotFoundError for non-existent webhook', async () => {
      await expect(
        deleteWebhook('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow();
    });
  });

  describe('listWebhooks', () => {
    it('lists webhooks for a repository', async () => {
      await createWebhook({
        repositoryId: repo.id,
        url: 'https://example.com/hook1',
        secret: 'secret1',
        events: ['push'],
        createdBy: user.id,
      });

      await createWebhook({
        repositoryId: repo.id,
        url: 'https://example.com/hook2',
        secret: 'secret2',
        events: ['pull_request'],
        createdBy: user.id,
      });

      const hooks = await listWebhooks(repo.id);

      expect(hooks).toHaveLength(2);
    });

    it('masks secrets in list response', async () => {
      await createWebhook({
        repositoryId: repo.id,
        url: 'https://example.com/hook',
        secret: 'my-secret',
        events: ['push'],
        createdBy: user.id,
      });

      const hooks = await listWebhooks(repo.id);
      // Secret should be omitted from the response
      expect((hooks[0] as any).secret).toBeUndefined();
    });

    it('returns empty array for repo with no webhooks', async () => {
      const hooks = await listWebhooks(repo.id);
      expect(hooks).toHaveLength(0);
    });
  });

  describe('getWebhook', () => {
    it('returns webhook with recent deliveries', async () => {
      const webhook = await createWebhook({
        repositoryId: repo.id,
        url: 'https://example.com/hook',
        secret: 'secret',
        events: ['push'],
        createdBy: user.id,
      });

      const result = await getWebhook(webhook.id);

      expect(result).not.toBeNull();
      expect(result!.url).toBe('https://example.com/hook');
      expect(result!.recentDeliveries).toBeDefined();
      expect(Array.isArray(result!.recentDeliveries)).toBe(true);
    });

    it('masks secret in response', async () => {
      const webhook = await createWebhook({
        repositoryId: repo.id,
        url: 'https://example.com/hook',
        secret: 'secret',
        events: ['push'],
        createdBy: user.id,
      });

      const result = await getWebhook(webhook.id);
      expect((result as any).secret).toBeUndefined();
    });

    it('returns null for non-existent webhook', async () => {
      const result = await getWebhook('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });

  describe('triggerEvent', () => {
    beforeEach(() => {
      // Mock global fetch for delivery attempts
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('OK'),
      }));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('creates delivery records for matching webhooks', async () => {
      await createWebhook({
        repositoryId: repo.id,
        url: 'https://example.com/hook',
        secret: 'secret',
        events: ['push'],
        createdBy: user.id,
      });

      await triggerEvent(repo.id, 'push', { ref: 'refs/heads/main' });

      // Give async delivery a moment to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = await getDeliveries(
        (await listWebhooks(repo.id))[0].id as any
      );

      expect(result.total).toBeGreaterThanOrEqual(1);
    });

    it('skips webhooks not subscribed to the event', async () => {
      const webhook = await createWebhook({
        repositoryId: repo.id,
        url: 'https://example.com/hook',
        secret: 'secret',
        events: ['issues'], // Only subscribes to issues
        createdBy: user.id,
      });

      await triggerEvent(repo.id, 'push', { ref: 'refs/heads/main' });
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = await getDeliveries(webhook.id);
      expect(result.total).toBe(0);
    });

    it('skips inactive webhooks', async () => {
      const webhook = await createWebhook({
        repositoryId: repo.id,
        url: 'https://example.com/hook',
        secret: 'secret',
        events: ['push'],
        createdBy: user.id,
      });

      await updateWebhook(webhook.id, { active: false });
      await triggerEvent(repo.id, 'push', { ref: 'refs/heads/main' });
      await new Promise(resolve => setTimeout(resolve, 100));

      const result = await getDeliveries(webhook.id);
      expect(result.total).toBe(0);
    });
  });

  describe('getDeliveries', () => {
    it('returns paginated deliveries', async () => {
      const webhook = await createWebhook({
        repositoryId: repo.id,
        url: 'https://example.com/hook',
        secret: 'secret',
        events: ['push'],
        createdBy: user.id,
      });

      // Insert delivery records directly
      const db = getTestDb();
      for (let i = 0; i < 5; i++) {
        await db.insert(webhookDeliveries).values({
          webhookId: webhook.id,
          event: 'push',
          payload: { ref: 'refs/heads/main' },
          status: 'delivered',
        });
      }

      const page1 = await getDeliveries(webhook.id, { limit: 3, offset: 0 });
      expect(page1.deliveries).toHaveLength(3);
      expect(page1.total).toBe(5);

      const page2 = await getDeliveries(webhook.id, { limit: 3, offset: 3 });
      expect(page2.deliveries).toHaveLength(2);
    });
  });
});
