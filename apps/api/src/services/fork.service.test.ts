import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTestDb, truncateAllTables } from '../test/test-db';
import { users, repositories, organizations, organizationMembers, repositoryMembers, branches, tags } from '../db/schema';
import { eq } from 'drizzle-orm';

// Mock git-backend.service before importing fork service
vi.mock('./git/git-backend.service', () => ({
  cloneBareRepo: vi.fn().mockResolvedValue('/var/lib/git/repos/target/repo.git'),
  getRefs: vi.fn().mockResolvedValue([
    { type: 'branch', name: 'main', sha: 'abc1234567890123456789012345678901234567' },
    { type: 'branch', name: 'develop', sha: 'def4567890123456789012345678901234567890' },
    { type: 'tag', name: 'v1.0.0', sha: '1234567890abcdef1234567890abcdef12345678' },
  ]),
}));

import { forkRepository, listForks } from './fork.service';

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
    defaultBranch: 'main',
    description: 'A test repository',
    ...overrides,
  }).returning();
  return repo;
}

describe('ForkService', () => {
  let sourceUser: typeof users.$inferSelect;
  let targetUser: typeof users.$inferSelect;
  let sourceRepo: typeof repositories.$inferSelect;

  beforeEach(async () => {
    await truncateAllTables();
    vi.clearAllMocks();

    sourceUser = await createTestUser({ username: 'sourceowner', email: 'source@example.com' });
    targetUser = await createTestUser({ username: 'forkuser', email: 'fork@example.com' });
    sourceRepo = await createTestRepo(sourceUser.id, {
      name: 'my-project',
      slug: 'my-project',
    });
  });

  describe('forkRepository', () => {
    it('creates a fork with correct metadata', async () => {
      const result = await forkRepository(sourceRepo.id, targetUser.id);

      expect(result.repository).toBeDefined();
      expect(result.repository.forkedFromId).toBe(sourceRepo.id);
      expect(result.repository.name).toBe('my-project');
      expect(result.repository.slug).toBe('my-project');
      expect(result.repository.description).toBe('A test repository');
      expect(result.repository.visibility).toBe('public');
      expect(result.repository.provider).toBe('local');
      expect(result.repository.userId).toBe(targetUser.id);
    });

    it('calls cloneBareRepo with correct arguments', async () => {
      const gitBackend = await import('./git/git-backend.service');

      await forkRepository(sourceRepo.id, targetUser.id);

      expect(gitBackend.cloneBareRepo).toHaveBeenCalledWith(
        'sourceowner',
        'my-project',
        'forkuser',
        'my-project'
      );
    });

    it('adds the forking user as admin member', async () => {
      const result = await forkRepository(sourceRepo.id, targetUser.id);
      const db = getTestDb();

      const members = await db.query.repositoryMembers.findMany({
        where: eq(repositoryMembers.repositoryId, result.repository.id),
      });

      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe(targetUser.id);
      expect(members[0].role).toBe('admin');
    });

    it('syncs branches and tags from source', async () => {
      const result = await forkRepository(sourceRepo.id, targetUser.id);
      const db = getTestDb();

      const forkBranches = await db.query.branches.findMany({
        where: eq(branches.repositoryId, result.repository.id),
      });

      const forkTags = await db.query.tags.findMany({
        where: eq(tags.repositoryId, result.repository.id),
      });

      expect(forkBranches).toHaveLength(2);
      expect(forkBranches.map(b => b.name).sort()).toEqual(['develop', 'main']);
      expect(forkTags).toHaveLength(1);
      expect(forkTags[0].name).toBe('v1.0.0');
    });

    it('sets default branch correctly', async () => {
      const result = await forkRepository(sourceRepo.id, targetUser.id);
      const db = getTestDb();

      const defaultBranch = await db.query.branches.findFirst({
        where: eq(branches.repositoryId, result.repository.id),
      });

      const mainBranch = await db.query.branches.findMany({
        where: eq(branches.repositoryId, result.repository.id),
      });

      const defaultOne = mainBranch.find(b => b.isDefault);
      expect(defaultOne?.name).toBe('main');
    });

    it('increments fork count on source repository', async () => {
      await forkRepository(sourceRepo.id, targetUser.id);
      const db = getTestDb();

      const [updated] = await db.select()
        .from(repositories)
        .where(eq(repositories.id, sourceRepo.id));

      expect(updated.forkCount).toBe(1);
    });

    it('throws ConflictError when user already has a fork', async () => {
      await forkRepository(sourceRepo.id, targetUser.id);

      await expect(
        forkRepository(sourceRepo.id, targetUser.id)
      ).rejects.toThrow('You already have a fork of this repository');
    });

    it('resolves slug conflicts by appending suffix', async () => {
      // Create an existing repo with the same slug under target user
      await createTestRepo(targetUser.id, {
        name: 'my-project',
        slug: 'my-project',
      });

      // Fork should get a suffixed name
      const thirdUser = await createTestUser();
      // Create a repo with same slug under third user to test
      // Actually fork the source repo to targetUser who already has 'my-project'
      // But targetUser already has a fork check... let's use a different setup
      // Create a repo with same slug, then fork to a new user who also has the slug
      const newUser = await createTestUser({ username: 'newuser', email: 'new@example.com' });
      await createTestRepo(newUser.id, { name: 'my-project', slug: 'my-project' });

      const result = await forkRepository(sourceRepo.id, newUser.id);
      expect(result.repository.slug).toBe('my-project-1');
      expect(result.repository.name).toBe('my-project-1');
    });

    it('allows custom fork name', async () => {
      const result = await forkRepository(sourceRepo.id, targetUser.id, {
        name: 'my-fork',
      });

      expect(result.repository.name).toBe('my-fork');
      expect(result.repository.slug).toBe('my-fork');
    });

    it('throws ValidationError for non-local provider repos', async () => {
      const githubRepo = await createTestRepo(sourceUser.id, {
        name: 'github-repo',
        slug: 'github-repo',
        provider: 'github',
      });

      await expect(
        forkRepository(githubRepo.id, targetUser.id)
      ).rejects.toThrow('Only local repositories can be forked');
    });

    it('throws NotFoundError for non-existent source repo', async () => {
      await expect(
        forkRepository('00000000-0000-0000-0000-000000000000', targetUser.id)
      ).rejects.toThrow();
    });
  });

  describe('listForks', () => {
    it('lists forks of a repository', async () => {
      const user2 = await createTestUser({ username: 'forker2', email: 'forker2@example.com' });

      await forkRepository(sourceRepo.id, targetUser.id);
      await forkRepository(sourceRepo.id, user2.id);

      const result = await listForks(sourceRepo.id);

      expect(result.forks).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('returns empty list for repo with no forks', async () => {
      const result = await listForks(sourceRepo.id);

      expect(result.forks).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('paginates results', async () => {
      const user2 = await createTestUser({ username: 'forker2', email: 'forker2@example.com' });
      const user3 = await createTestUser({ username: 'forker3', email: 'forker3@example.com' });

      await forkRepository(sourceRepo.id, targetUser.id);
      await forkRepository(sourceRepo.id, user2.id);
      await forkRepository(sourceRepo.id, user3.id);

      const page1 = await listForks(sourceRepo.id, { limit: 2, offset: 0 });
      expect(page1.forks).toHaveLength(2);
      expect(page1.total).toBe(3);

      const page2 = await listForks(sourceRepo.id, { limit: 2, offset: 2 });
      expect(page2.forks).toHaveLength(1);
    });

    it('includes owner info in fork results', async () => {
      await forkRepository(sourceRepo.id, targetUser.id);

      const result = await listForks(sourceRepo.id);

      expect((result.forks[0] as any).owner).toBeDefined();
    });
  });
});
