import { describe, it, expect, beforeEach } from 'vitest';
import {
  addTagProtection,
  removeTagProtection,
  listTagProtection,
  getTagProtection,
  validateTagPush,
  matchesTagPattern,
  extractTagName,
} from './tag-protection.service';
import { getTestDb, truncateAllTables } from '../test/test-db';
import { users, repositories, repositoryMembers } from '../db/schema';

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

const ZERO_SHA = '0000000000000000000000000000000000000000';
const SOME_SHA = 'abc1234567890123456789012345678901234567';
const OTHER_SHA = 'def4567890123456789012345678901234567890';

describe('TagProtectionService', () => {
  let user: typeof users.$inferSelect;
  let repo: typeof repositories.$inferSelect;

  beforeEach(async () => {
    await truncateAllTables();
    user = await createTestUser();
    repo = await createTestRepo(user.id);
  });

  // ============================================================
  // Pattern Matching
  // ============================================================
  describe('matchesTagPattern', () => {
    it('matches exact tag names', () => {
      expect(matchesTagPattern('v1.0.0', 'v1.0.0')).toBe(true);
      expect(matchesTagPattern('v1.0.0', 'v1.0.1')).toBe(false);
    });

    it('matches wildcard patterns', () => {
      expect(matchesTagPattern('v1.0.0', 'v*')).toBe(true);
      expect(matchesTagPattern('v2.0.0', 'v*')).toBe(true);
      expect(matchesTagPattern('release-1.0', 'release-*')).toBe(true);
      expect(matchesTagPattern('other-tag', 'v*')).toBe(false);
    });

    it('matches single-char wildcards', () => {
      expect(matchesTagPattern('v1', 'v?')).toBe(true);
      expect(matchesTagPattern('v12', 'v?')).toBe(false);
    });

    it('matches complex patterns', () => {
      expect(matchesTagPattern('v1.0.0', 'v?.*.?')).toBe(true);
      expect(matchesTagPattern('v10.0.0', 'v?.*.?')).toBe(false);
    });
  });

  describe('extractTagName', () => {
    it('extracts tag name from refs/tags/ prefix', () => {
      expect(extractTagName('refs/tags/v1.0.0')).toBe('v1.0.0');
    });

    it('returns null for non-tag refs', () => {
      expect(extractTagName('refs/heads/main')).toBeNull();
      expect(extractTagName('refs/remotes/origin/main')).toBeNull();
    });
  });

  // ============================================================
  // CRUD Operations
  // ============================================================
  describe('addTagProtection', () => {
    it('creates a tag protection rule', async () => {
      const rule = await addTagProtection(repo.id, 'v*', user.id);

      expect(rule.id).toBeDefined();
      expect(rule.repositoryId).toBe(repo.id);
      expect(rule.pattern).toBe('v*');
      expect(rule.allowAdminOverride).toBe(true);
      expect(rule.createdBy).toBe(user.id);
    });

    it('rejects duplicate patterns', async () => {
      await addTagProtection(repo.id, 'v*');

      await expect(
        addTagProtection(repo.id, 'v*')
      ).rejects.toThrow('already exists');
    });

    it('rejects empty pattern', async () => {
      await expect(
        addTagProtection(repo.id, '')
      ).rejects.toThrow('Pattern is required');
    });

    it('allows different patterns', async () => {
      await addTagProtection(repo.id, 'v*');
      const rule2 = await addTagProtection(repo.id, 'release-*');

      expect(rule2.pattern).toBe('release-*');
    });
  });

  describe('removeTagProtection', () => {
    it('removes a rule', async () => {
      const rule = await addTagProtection(repo.id, 'v*');
      await removeTagProtection(rule.id, repo.id);

      const rules = await listTagProtection(repo.id);
      expect(rules).toHaveLength(0);
    });

    it('throws NotFoundError for non-existent rule', async () => {
      await expect(
        removeTagProtection('00000000-0000-0000-0000-000000000000', repo.id)
      ).rejects.toThrow();
    });

    it('throws NotFoundError for wrong repo', async () => {
      const rule = await addTagProtection(repo.id, 'v*');
      const otherRepo = await createTestRepo(user.id);

      await expect(
        removeTagProtection(rule.id, otherRepo.id)
      ).rejects.toThrow();
    });
  });

  describe('listTagProtection', () => {
    it('lists all rules for a repo', async () => {
      await addTagProtection(repo.id, 'v*');
      await addTagProtection(repo.id, 'release-*');

      const rules = await listTagProtection(repo.id);
      expect(rules).toHaveLength(2);
    });

    it('returns empty array when no rules exist', async () => {
      const rules = await listTagProtection(repo.id);
      expect(rules).toHaveLength(0);
    });
  });

  describe('getTagProtection', () => {
    it('gets a specific rule', async () => {
      const created = await addTagProtection(repo.id, 'v*');
      const fetched = await getTagProtection(created.id, repo.id);

      expect(fetched.id).toBe(created.id);
      expect(fetched.pattern).toBe('v*');
    });

    it('throws NotFoundError for non-existent rule', async () => {
      await expect(
        getTagProtection('00000000-0000-0000-0000-000000000000', repo.id)
      ).rejects.toThrow();
    });
  });

  // ============================================================
  // Push Validation
  // ============================================================
  describe('validateTagPush', () => {
    beforeEach(async () => {
      await addTagProtection(repo.id, 'v*', user.id, true);
    });

    it('allows creating a protected tag', async () => {
      const result = await validateTagPush(repo.id, 'refs/tags/v1.0.0', ZERO_SHA, SOME_SHA, false);
      expect(result.allowed).toBe(true);
    });

    it('blocks deleting a protected tag', async () => {
      const result = await validateTagPush(repo.id, 'refs/tags/v1.0.0', SOME_SHA, ZERO_SHA, false);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Cannot delete protected tag');
    });

    it('blocks overwriting a protected tag', async () => {
      const result = await validateTagPush(repo.id, 'refs/tags/v1.0.0', SOME_SHA, OTHER_SHA, false);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Cannot overwrite protected tag');
    });

    it('allows non-matching tags', async () => {
      const result = await validateTagPush(repo.id, 'refs/tags/unrelated', SOME_SHA, ZERO_SHA, false);
      expect(result.allowed).toBe(true);
    });

    it('allows admin override when enabled', async () => {
      const result = await validateTagPush(repo.id, 'refs/tags/v1.0.0', SOME_SHA, ZERO_SHA, true);
      expect(result.allowed).toBe(true);
    });

    it('blocks admin when override is disabled', async () => {
      // Add a rule without admin override
      await addTagProtection(repo.id, 'strict-*', user.id, false);

      const result = await validateTagPush(repo.id, 'refs/tags/strict-1.0', SOME_SHA, ZERO_SHA, true);
      expect(result.allowed).toBe(false);
    });

    it('allows all operations when no rules exist', async () => {
      const otherRepo = await createTestRepo(user.id);

      const result = await validateTagPush(otherRepo.id, 'refs/tags/v1.0.0', SOME_SHA, ZERO_SHA, false);
      expect(result.allowed).toBe(true);
    });

    it('allows non-tag refs', async () => {
      const result = await validateTagPush(repo.id, 'refs/heads/main', SOME_SHA, ZERO_SHA, false);
      expect(result.allowed).toBe(true);
    });
  });
});
