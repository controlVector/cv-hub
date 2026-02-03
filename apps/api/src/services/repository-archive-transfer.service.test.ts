import { describe, it, expect, beforeEach } from 'vitest';
import {
  setRepositoryArchived,
  transferRepository,
  canUserWriteToRepo,
  isRepoAdmin,
} from './repository.service';
import { getTestDb, truncateAllTables } from '../test/test-db';
import { users, repositories, repositoryMembers, organizations, organizationMembers } from '../db/schema';
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

async function createTestRepo(userId: string, overrides: Partial<typeof repositories.$inferInsert> = {}) {
  const db = getTestDb();
  const slug = overrides.slug || `test-repo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [repo] = await db.insert(repositories).values({
    userId,
    name: overrides.name || slug,
    slug,
    visibility: 'public',
    provider: 'local',
    ...overrides,
  }).returning();
  return repo;
}

describe('Repository Archive/Transfer Service', () => {
  let owner: typeof users.$inferSelect;
  let repo: typeof repositories.$inferSelect;

  beforeEach(async () => {
    await truncateAllTables();
    owner = await createTestUser({ username: 'owner', email: 'owner@example.com' });
    repo = await createTestRepo(owner.id, { name: 'test-repo', slug: 'test-repo' });
  });

  // ============================================================
  // FEAT-014: Archive / Unarchive
  // ============================================================
  describe('setRepositoryArchived', () => {
    it('archives a repository', async () => {
      const updated = await setRepositoryArchived(repo.id, true);

      expect(updated).not.toBeNull();
      expect(updated!.isArchived).toBe(true);
      expect(updated!.archivedAt).not.toBeNull();
    });

    it('unarchives a repository', async () => {
      await setRepositoryArchived(repo.id, true);
      const updated = await setRepositoryArchived(repo.id, false);

      expect(updated).not.toBeNull();
      expect(updated!.isArchived).toBe(false);
      expect(updated!.archivedAt).toBeNull();
    });

    it('returns null for non-existent repo', async () => {
      const updated = await setRepositoryArchived('00000000-0000-0000-0000-000000000000', true);
      expect(updated).toBeNull();
    });
  });

  describe('canUserWriteToRepo - archived repo check', () => {
    it('blocks writes when repo is archived', async () => {
      await setRepositoryArchived(repo.id, true);
      const canWrite = await canUserWriteToRepo(repo.id, owner.id);
      expect(canWrite).toBe(false);
    });

    it('allows writes when repo is not archived', async () => {
      const canWrite = await canUserWriteToRepo(repo.id, owner.id);
      expect(canWrite).toBe(true);
    });

    it('allows writes after unarchiving', async () => {
      await setRepositoryArchived(repo.id, true);
      await setRepositoryArchived(repo.id, false);
      const canWrite = await canUserWriteToRepo(repo.id, owner.id);
      expect(canWrite).toBe(true);
    });

    it('blocks writes for member when archived', async () => {
      const db = getTestDb();
      const writer = await createTestUser({ username: 'writer', email: 'writer@example.com' });
      await db.insert(repositoryMembers).values({
        repositoryId: repo.id,
        userId: writer.id,
        role: 'write',
      });

      await setRepositoryArchived(repo.id, true);
      const canWrite = await canUserWriteToRepo(repo.id, writer.id);
      expect(canWrite).toBe(false);
    });
  });

  // ============================================================
  // FEAT-013: Transfer Repository
  // ============================================================
  describe('transferRepository', () => {
    it('transfers to a different user', async () => {
      const newOwner = await createTestUser({ username: 'newowner', email: 'new@example.com' });
      const updated = await transferRepository(repo.id, null, newOwner.id);

      expect(updated).not.toBeNull();
      expect(updated!.userId).toBe(newOwner.id);
      expect(updated!.organizationId).toBeNull();
    });

    it('transfers to an organization', async () => {
      const db = getTestDb();
      const [org] = await db.insert(organizations).values({
        name: 'Test Org',
        slug: 'test-org',
      }).returning();

      const updated = await transferRepository(repo.id, org.id, null);

      expect(updated).not.toBeNull();
      expect(updated!.organizationId).toBe(org.id);
      expect(updated!.userId).toBeNull();
    });

    it('throws when neither target is provided', async () => {
      await expect(
        transferRepository(repo.id, null, null)
      ).rejects.toThrow('Must specify either organization or user as target');
    });

    it('returns null for non-existent repo', async () => {
      const updated = await transferRepository('00000000-0000-0000-0000-000000000000', null, owner.id);
      expect(updated).toBeNull();
    });

    it('updates ownership correctly after transfer', async () => {
      const newOwner = await createTestUser();
      await transferRepository(repo.id, null, newOwner.id);

      // New owner should have admin access
      const isAdmin = await isRepoAdmin(repo.id, newOwner.id);
      expect(isAdmin).toBe(true);

      // Old owner should no longer be admin
      const oldIsAdmin = await isRepoAdmin(repo.id, owner.id);
      expect(oldIsAdmin).toBe(false);
    });
  });
});
