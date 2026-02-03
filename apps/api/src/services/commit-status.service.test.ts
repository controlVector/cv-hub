import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCommitStatus,
  getCommitStatuses,
  getCombinedStatus,
  checkRequiredStatuses,
} from './commit-status.service';
import { getTestDb, truncateAllTables } from '../test/test-db';
import { users, repositories } from '../db/schema';

// Test data helpers
async function createTestUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const db = getTestDb();
  const [user] = await db.insert(users).values({
    username: `testuser_${Date.now()}`,
    email: `test_${Date.now()}@example.com`,
    displayName: 'Test User',
    emailVerified: true,
    ...overrides,
  }).returning();
  return user;
}

async function createTestRepo(userId: string, overrides: Partial<typeof repositories.$inferInsert> = {}) {
  const db = getTestDb();
  const slug = `test-repo-${Date.now()}`;
  const [repo] = await db.insert(repositories).values({
    userId,
    name: slug,
    slug,
    visibility: 'public',
    provider: 'local',
    ...overrides,
  }).returning();
  return repo;
}

describe('CommitStatusService', () => {
  let user: typeof users.$inferSelect;
  let repo: typeof repositories.$inferSelect;

  beforeEach(async () => {
    await truncateAllTables();
    user = await createTestUser();
    repo = await createTestRepo(user.id);
  });

  describe('createCommitStatus', () => {
    it('creates a commit status with defaults', async () => {
      const status = await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'pending',
        creatorId: user.id,
      });

      expect(status.id).toBeDefined();
      expect(status.repositoryId).toBe(repo.id);
      expect(status.sha).toBe('abc1234');
      expect(status.state).toBe('pending');
      expect(status.context).toBe('default');
      expect(status.creatorId).toBe(user.id);
    });

    it('creates a status with custom context and description', async () => {
      const status = await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234def5678',
        state: 'success',
        context: 'ci/build',
        description: 'Build passed',
        targetUrl: 'https://ci.example.com/build/123',
        creatorId: user.id,
      });

      expect(status.context).toBe('ci/build');
      expect(status.description).toBe('Build passed');
      expect(status.targetUrl).toBe('https://ci.example.com/build/123');
      expect(status.state).toBe('success');
    });

    it('allows multiple statuses for the same context', async () => {
      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'pending',
        context: 'ci/test',
      });

      const second = await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'success',
        context: 'ci/test',
      });

      expect(second.state).toBe('success');
    });

    it('throws ValidationError for invalid SHA', async () => {
      await expect(
        createCommitStatus({
          repositoryId: repo.id,
          sha: 'NOT_A_VALID_SHA!!',
          state: 'pending',
        })
      ).rejects.toThrow('Invalid commit SHA');
    });

    it('throws ValidationError for too-short SHA', async () => {
      await expect(
        createCommitStatus({
          repositoryId: repo.id,
          sha: 'ab',
          state: 'pending',
        })
      ).rejects.toThrow('Invalid commit SHA');
    });

    it('throws NotFoundError for non-existent repository', async () => {
      await expect(
        createCommitStatus({
          repositoryId: '00000000-0000-0000-0000-000000000000',
          sha: 'abc1234',
          state: 'pending',
        })
      ).rejects.toThrow();
    });
  });

  describe('getCommitStatuses', () => {
    it('returns all statuses for a commit ordered by most recent', async () => {
      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'pending',
        context: 'ci/build',
        creatorId: user.id,
      });

      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'success',
        context: 'ci/test',
        creatorId: user.id,
      });

      const statuses = await getCommitStatuses(repo.id, 'abc1234');

      expect(statuses).toHaveLength(2);
      // Most recent first
      expect(statuses[0].context).toBe('ci/test');
      expect(statuses[1].context).toBe('ci/build');
    });

    it('returns empty array for unknown SHA', async () => {
      const statuses = await getCommitStatuses(repo.id, 'deadbeef');
      expect(statuses).toHaveLength(0);
    });

    it('includes creator info', async () => {
      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'success',
        creatorId: user.id,
      });

      const statuses = await getCommitStatuses(repo.id, 'abc1234');
      const status = statuses[0] as any;
      expect(status.creator).toBeDefined();
      expect(status.creator.username).toBe(user.username);
    });
  });

  describe('getCombinedStatus', () => {
    it('returns pending when no statuses exist', async () => {
      const combined = await getCombinedStatus(repo.id, 'abc1234');

      expect(combined.state).toBe('pending');
      expect(combined.totalCount).toBe(0);
      expect(combined.sha).toBe('abc1234');
    });

    it('returns success when all contexts are successful', async () => {
      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'success',
        context: 'ci/build',
      });

      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'success',
        context: 'ci/test',
      });

      const combined = await getCombinedStatus(repo.id, 'abc1234');
      expect(combined.state).toBe('success');
      expect(combined.totalCount).toBe(2);
    });

    it('returns failure when any context has failed', async () => {
      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'success',
        context: 'ci/build',
      });

      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'failure',
        context: 'ci/test',
      });

      const combined = await getCombinedStatus(repo.id, 'abc1234');
      expect(combined.state).toBe('failure');
    });

    it('returns error when any context has error (highest priority)', async () => {
      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'failure',
        context: 'ci/build',
      });

      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'error',
        context: 'ci/test',
      });

      const combined = await getCombinedStatus(repo.id, 'abc1234');
      expect(combined.state).toBe('error');
    });

    it('returns pending when any context is pending (and none error/failure)', async () => {
      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'success',
        context: 'ci/build',
      });

      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'pending',
        context: 'ci/test',
      });

      const combined = await getCombinedStatus(repo.id, 'abc1234');
      expect(combined.state).toBe('pending');
    });

    it('uses only the latest status per context', async () => {
      // First: pending
      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'pending',
        context: 'ci/build',
      });

      // Second: success (latest for same context)
      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'success',
        context: 'ci/build',
      });

      const combined = await getCombinedStatus(repo.id, 'abc1234');
      expect(combined.state).toBe('success');
      expect(combined.totalCount).toBe(1); // Only 1 unique context
    });
  });

  describe('checkRequiredStatuses', () => {
    it('returns passed when all required checks are successful', async () => {
      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'success',
        context: 'ci/build',
      });

      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'success',
        context: 'ci/test',
      });

      const result = await checkRequiredStatuses(repo.id, 'abc1234', ['ci/build', 'ci/test']);

      expect(result.passed).toBe(true);
      expect(result.missing).toHaveLength(0);
      expect(result.failing).toHaveLength(0);
    });

    it('reports missing required checks', async () => {
      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'success',
        context: 'ci/build',
      });

      const result = await checkRequiredStatuses(repo.id, 'abc1234', ['ci/build', 'ci/test', 'ci/lint']);

      expect(result.passed).toBe(false);
      expect(result.missing).toEqual(['ci/test', 'ci/lint']);
    });

    it('reports failing required checks', async () => {
      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'success',
        context: 'ci/build',
      });

      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'failure',
        context: 'ci/test',
      });

      const result = await checkRequiredStatuses(repo.id, 'abc1234', ['ci/build', 'ci/test']);

      expect(result.passed).toBe(false);
      expect(result.failing).toEqual(['ci/test (failure)']);
    });

    it('reports both missing and failing checks', async () => {
      await createCommitStatus({
        repositoryId: repo.id,
        sha: 'abc1234',
        state: 'error',
        context: 'ci/build',
      });

      const result = await checkRequiredStatuses(repo.id, 'abc1234', ['ci/build', 'ci/test']);

      expect(result.passed).toBe(false);
      expect(result.missing).toEqual(['ci/test']);
      expect(result.failing).toEqual(['ci/build (error)']);
    });

    it('passes with empty required checks list', async () => {
      const result = await checkRequiredStatuses(repo.id, 'abc1234', []);
      expect(result.passed).toBe(true);
    });
  });
});
