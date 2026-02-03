import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTestDb, truncateAllTables } from '../test/test-db';
import { users, repositories, pullRequests, branches } from '../db/schema';
import { eq, and } from 'drizzle-orm';

// Mock pr.service to prevent actual git operations during auto-merge
vi.mock('./pr.service', () => ({
  mergePullRequest: vi.fn().mockResolvedValue({ id: 'merged', state: 'merged' }),
}));

// Mock commit-status.service
vi.mock('./commit-status.service', () => ({
  getCombinedStatus: vi.fn().mockResolvedValue({ state: 'success', totalCount: 1 }),
  checkRequiredStatuses: vi.fn().mockResolvedValue({ passed: true, missing: [], failing: [] }),
}));

import {
  enableAutoMerge,
  disableAutoMerge,
  getAutoMergeStatus,
  checkAndTriggerAutoMerge,
  disableAutoMergeOnUpdate,
} from './auto-merge.service';
import { mergePullRequest } from './pr.service';
import { checkRequiredStatuses } from './commit-status.service';

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

async function createTestPR(repoId: string, authorId: string, overrides: Partial<typeof pullRequests.$inferInsert> = {}) {
  const db = getTestDb();
  const [pr] = await db.insert(pullRequests).values({
    repositoryId: repoId,
    number: Math.floor(Math.random() * 10000),
    title: 'Test PR',
    sourceBranch: 'feature',
    targetBranch: 'main',
    authorId,
    state: 'open',
    ...overrides,
  }).returning();
  return pr;
}

describe('AutoMergeService', () => {
  let user: typeof users.$inferSelect;
  let repo: typeof repositories.$inferSelect;
  let pr: typeof pullRequests.$inferSelect;

  beforeEach(async () => {
    await truncateAllTables();
    vi.clearAllMocks();

    user = await createTestUser();
    repo = await createTestRepo(user.id);
    pr = await createTestPR(repo.id, user.id);
  });

  // ============================================================
  // Enable / Disable
  // ============================================================
  describe('enableAutoMerge', () => {
    it('enables auto-merge with default method', async () => {
      const status = await enableAutoMerge(pr.id, user.id);

      expect(status.enabled).toBe(true);
      expect(status.method).toBe('merge');
      expect(status.enabledBy).toBe(user.id);
      expect(status.enabledAt).toBeDefined();
    });

    it('enables auto-merge with squash method', async () => {
      const status = await enableAutoMerge(pr.id, user.id, 'squash');
      expect(status.method).toBe('squash');
    });

    it('enables auto-merge with rebase method', async () => {
      const status = await enableAutoMerge(pr.id, user.id, 'rebase');
      expect(status.method).toBe('rebase');
    });

    it('throws for non-existent PR', async () => {
      await expect(
        enableAutoMerge('00000000-0000-0000-0000-000000000000', user.id)
      ).rejects.toThrow('Pull request not found');
    });

    it('throws for closed PR', async () => {
      const db = getTestDb();
      const closedPR = await createTestPR(repo.id, user.id, { state: 'closed' });

      await expect(
        enableAutoMerge(closedPR.id, user.id)
      ).rejects.toThrow('open pull requests');
    });

    it('throws for draft PR', async () => {
      const draftPR = await createTestPR(repo.id, user.id, { isDraft: true });

      await expect(
        enableAutoMerge(draftPR.id, user.id)
      ).rejects.toThrow('draft');
    });

    it('throws when already enabled', async () => {
      await enableAutoMerge(pr.id, user.id);

      await expect(
        enableAutoMerge(pr.id, user.id)
      ).rejects.toThrow('already enabled');
    });
  });

  describe('disableAutoMerge', () => {
    it('disables auto-merge', async () => {
      await enableAutoMerge(pr.id, user.id);
      const status = await disableAutoMerge(pr.id);

      expect(status.enabled).toBe(false);
      expect(status.method).toBeNull();
      expect(status.enabledBy).toBeNull();
    });

    it('throws when not enabled', async () => {
      await expect(
        disableAutoMerge(pr.id)
      ).rejects.toThrow('not enabled');
    });

    it('throws for non-existent PR', async () => {
      await expect(
        disableAutoMerge('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Pull request not found');
    });
  });

  describe('getAutoMergeStatus', () => {
    it('returns disabled status by default', async () => {
      const status = await getAutoMergeStatus(pr.id);

      expect(status.enabled).toBe(false);
      expect(status.method).toBeNull();
    });

    it('returns enabled status after enabling', async () => {
      await enableAutoMerge(pr.id, user.id, 'squash');
      const status = await getAutoMergeStatus(pr.id);

      expect(status.enabled).toBe(true);
      expect(status.method).toBe('squash');
      expect(status.enabledBy).toBe(user.id);
    });

    it('throws for non-existent PR', async () => {
      await expect(
        getAutoMergeStatus('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Pull request not found');
    });
  });

  // ============================================================
  // Auto-Merge Trigger
  // ============================================================
  describe('checkAndTriggerAutoMerge', () => {
    it('merges when auto-merge is enabled and conditions met', async () => {
      // Create a PR with no review requirements so auto-merge can proceed
      const noReviewPR = await createTestPR(repo.id, user.id, { requiredReviewers: 0 });
      await enableAutoMerge(noReviewPR.id, user.id, 'merge');

      const merged = await checkAndTriggerAutoMerge(noReviewPR.id);

      expect(merged).toBe(true);
      expect(mergePullRequest).toHaveBeenCalledWith(noReviewPR.id, user.id, 'merge');
    });

    it('does not merge when auto-merge is disabled', async () => {
      const merged = await checkAndTriggerAutoMerge(pr.id);

      expect(merged).toBe(false);
      expect(mergePullRequest).not.toHaveBeenCalled();
    });

    it('does not merge when PR is not open', async () => {
      const closedPR = await createTestPR(repo.id, user.id, { state: 'closed' });

      const merged = await checkAndTriggerAutoMerge(closedPR.id);
      expect(merged).toBe(false);
    });

    it('does not merge when required reviews not met', async () => {
      const prWithReviews = await createTestPR(repo.id, user.id, {
        requiredReviewers: 2,
      });
      await enableAutoMerge(prWithReviews.id, user.id);

      const merged = await checkAndTriggerAutoMerge(prWithReviews.id);
      expect(merged).toBe(false);
    });

    it('does not merge when status checks fail', async () => {
      const db = getTestDb();

      // Create a branch with protection rules
      await db.insert(branches).values({
        repositoryId: repo.id,
        name: 'main',
        sha: 'abc1234567890123456789012345678901234567',
        isDefault: true,
        isProtected: true,
        protectionRules: { requireStatusChecks: ['ci/build'] },
      });

      const prWithSha = await createTestPR(repo.id, user.id, {
        sourceSha: 'abc1234567890123456789012345678901234567',
        targetBranch: 'main',
      });
      await enableAutoMerge(prWithSha.id, user.id);

      // Mock status checks failing
      vi.mocked(checkRequiredStatuses).mockResolvedValueOnce({
        passed: false,
        missing: ['ci/build'],
        failing: [],
      });

      const merged = await checkAndTriggerAutoMerge(prWithSha.id);
      expect(merged).toBe(false);
    });

    it('returns false for non-existent PR', async () => {
      const merged = await checkAndTriggerAutoMerge('00000000-0000-0000-0000-000000000000');
      expect(merged).toBe(false);
    });
  });

  // ============================================================
  // Disable on Update
  // ============================================================
  describe('disableAutoMergeOnUpdate', () => {
    it('disables auto-merge when new commits are pushed', async () => {
      await enableAutoMerge(pr.id, user.id);

      await disableAutoMergeOnUpdate(repo.id, 'feature');

      const status = await getAutoMergeStatus(pr.id);
      expect(status.enabled).toBe(false);
    });

    it('does not affect PRs on other branches', async () => {
      await enableAutoMerge(pr.id, user.id);

      await disableAutoMergeOnUpdate(repo.id, 'other-branch');

      const status = await getAutoMergeStatus(pr.id);
      expect(status.enabled).toBe(true);
    });

    it('handles multiple PRs on same branch', async () => {
      const pr2 = await createTestPR(repo.id, user.id, { sourceBranch: 'feature' });
      await enableAutoMerge(pr.id, user.id);
      await enableAutoMerge(pr2.id, user.id);

      await disableAutoMergeOnUpdate(repo.id, 'feature');

      const status1 = await getAutoMergeStatus(pr.id);
      const status2 = await getAutoMergeStatus(pr2.id);
      expect(status1.enabled).toBe(false);
      expect(status2.enabled).toBe(false);
    });

    it('does nothing when no auto-merge PRs exist', async () => {
      // Should not throw
      await disableAutoMergeOnUpdate(repo.id, 'feature');
    });
  });
});
