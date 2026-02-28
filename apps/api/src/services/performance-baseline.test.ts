/**
 * Performance Baseline Tests (Sprint 8 — Step 5)
 *
 * Records execution times for key service operations to establish
 * baselines. Tests assert generous upper bounds to catch regressions
 * without being flaky.
 *
 * 5a. User operations — registration, authentication
 * 5b. Organization operations — create, list, invite
 * 5c. Repository operations — create, list, access check
 * 5d. Task operations — create, list, status transitions
 * 5e. PAT operations — create, validate, revoke
 * 5f. Bulk operations — multiple creates, listing with filters
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createUser, authenticateUser } from './user.service';
import {
  createOrganization,
  getUserOrganizations,
  createInvite,
  acceptInviteByToken,
  listOrganizationMembers,
} from './organization.service';
import {
  createRepository,
  getUserAccessibleRepositories,
  canUserAccessRepo,
} from './repository.service';
import {
  createAgentTask,
  listAgentTasks,
  updateAgentTaskStatus,
} from './agent-task.service';
import { createToken, validateToken, revokeToken, listTokens } from './pat.service';

let seq = 0;
function uid() { return `perf_${Date.now()}_${++seq}`; }

/** Time a function, return [result, durationMs]. */
async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const result = await fn();
  const elapsed = performance.now() - start;
  return [result, elapsed];
}

// Generous upper bounds (ms) — these are "must not exceed" limits
// designed to catch severe regressions, not micro-benchmark.
const LIMITS = {
  userCreate: 2000,
  userAuth: 2000,
  orgCreate: 1000,
  orgList: 500,
  repoCreate: 2000,
  repoList: 500,
  repoAccess: 500,
  taskCreate: 500,
  taskList: 500,
  taskStatusChange: 500,
  patCreate: 500,
  patValidate: 500,
  patRevoke: 500,
  bulkCreate10: 10000,
  inviteFlow: 2000,
};

// ---------------------------------------------------------------------------
// 5a. User Operations
// ---------------------------------------------------------------------------

describe('Performance: User Operations', () => {
  it(`creates a user within ${LIMITS.userCreate}ms`, async () => {
    const u = uid();
    const [user, ms] = await timed(() =>
      createUser({ email: `perf_${u}@test.com`, username: `perf_${u}`, password: 'pass123' }),
    );
    expect(user.id).toBeTruthy();
    expect(ms).toBeLessThan(LIMITS.userCreate);
  });

  it(`authenticates a user within ${LIMITS.userAuth}ms`, async () => {
    const u = uid();
    await createUser({ email: `auth_${u}@test.com`, username: `auth_${u}`, password: 'pass123' });

    const [authed, ms] = await timed(() =>
      authenticateUser(`auth_${u}@test.com`, 'pass123'),
    );
    expect(authed.id).toBeTruthy();
    expect(ms).toBeLessThan(LIMITS.userAuth);
  });
});

// ---------------------------------------------------------------------------
// 5b. Organization Operations
// ---------------------------------------------------------------------------

describe('Performance: Organization Operations', () => {
  let userId: string;
  let userEmail: string;

  beforeEach(async () => {
    const u = uid();
    userEmail = `org_${u}@test.com`;
    const user = await createUser({ email: userEmail, username: `org_${u}`, password: 'pass123' });
    userId = user.id;
  });

  it(`creates an organization within ${LIMITS.orgCreate}ms`, async () => {
    const u = uid();
    const [org, ms] = await timed(() =>
      createOrganization({ slug: `perf-org-${u}`, name: 'Perf Org', isPublic: true }, userId),
    );
    expect(org.id).toBeTruthy();
    expect(ms).toBeLessThan(LIMITS.orgCreate);
  });

  it(`lists user organizations within ${LIMITS.orgList}ms`, async () => {
    const u = uid();
    await createOrganization({ slug: `list-org-${u}`, name: 'List Org', isPublic: true }, userId);

    const [orgs, ms] = await timed(() => getUserOrganizations(userId));
    expect(orgs.length).toBeGreaterThanOrEqual(1);
    expect(ms).toBeLessThan(LIMITS.orgList);
  });

  it(`completes invite flow within ${LIMITS.inviteFlow}ms`, async () => {
    const u = uid();
    const org = await createOrganization({ slug: `inv-org-${u}`, name: 'Inv Org', isPublic: true }, userId);
    const invitee = await createUser({ email: `inv_${u}@test.com`, username: `inv_${u}`, password: 'pass123' });

    const [, ms] = await timed(async () => {
      const invite = await createInvite(org.id, `inv_${u}@test.com`, 'member', userId);
      return acceptInviteByToken(invite.token, invitee.id, `inv_${u}@test.com`);
    });
    expect(ms).toBeLessThan(LIMITS.inviteFlow);
  });
});

// ---------------------------------------------------------------------------
// 5c. Repository Operations
// ---------------------------------------------------------------------------

describe('Performance: Repository Operations', () => {
  let userId: string;
  let orgId: string;

  beforeEach(async () => {
    const u = uid();
    const user = await createUser({ email: `repo_${u}@test.com`, username: `repo_${u}`, password: 'pass123' });
    userId = user.id;
    const org = await createOrganization({ slug: `repo-org-${u}`, name: 'Repo Org', isPublic: true }, userId);
    orgId = org.id;
  });

  it(`creates a repository within ${LIMITS.repoCreate}ms`, async () => {
    const u = uid();
    const [repo, ms] = await timed(() =>
      createRepository(
        { slug: `perf-repo-${u}`, name: `perf-repo-${u}`, organizationId: orgId, visibility: 'internal' },
        userId,
      ),
    );
    expect(repo.id).toBeTruthy();
    expect(ms).toBeLessThan(LIMITS.repoCreate);
  });

  it(`lists accessible repos within ${LIMITS.repoList}ms`, async () => {
    const u = uid();
    await createRepository(
      { slug: `list-repo-${u}`, name: `list-repo-${u}`, organizationId: orgId, visibility: 'internal' },
      userId,
    );

    const [repos, ms] = await timed(() => getUserAccessibleRepositories(userId));
    expect(repos.length).toBeGreaterThanOrEqual(1);
    expect(ms).toBeLessThan(LIMITS.repoList);
  });

  it(`checks repo access within ${LIMITS.repoAccess}ms`, async () => {
    const u = uid();
    const repo = await createRepository(
      { slug: `access-repo-${u}`, name: `access-repo-${u}`, organizationId: orgId, visibility: 'private' },
      userId,
    );

    const [result, ms] = await timed(() => canUserAccessRepo(repo.id, userId));
    expect(typeof result).toBe('boolean');
    expect(ms).toBeLessThan(LIMITS.repoAccess);
  });
});

// ---------------------------------------------------------------------------
// 5d. Task Operations
// ---------------------------------------------------------------------------

describe('Performance: Task Operations', () => {
  let userId: string;

  beforeEach(async () => {
    const u = uid();
    const user = await createUser({ email: `task_${u}@test.com`, username: `task_${u}`, password: 'pass123' });
    userId = user.id;
  });

  it(`creates a task within ${LIMITS.taskCreate}ms`, async () => {
    const [task, ms] = await timed(() =>
      createAgentTask({ userId, title: 'Perf Task', taskType: 'debug', priority: 'high' }),
    );
    expect(task.id).toBeTruthy();
    expect(ms).toBeLessThan(LIMITS.taskCreate);
  });

  it(`lists tasks within ${LIMITS.taskList}ms`, async () => {
    await createAgentTask({ userId, title: 'Task 1', taskType: 'debug', priority: 'medium' });
    await createAgentTask({ userId, title: 'Task 2', taskType: 'review', priority: 'low' });

    const [tasks, ms] = await timed(() => listAgentTasks({ userId }));
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    expect(ms).toBeLessThan(LIMITS.taskList);
  });

  it(`changes task status within ${LIMITS.taskStatusChange}ms`, async () => {
    const task = await createAgentTask({ userId, title: 'Status Task', taskType: 'deploy', priority: 'critical' });

    const [updated, ms] = await timed(() => updateAgentTaskStatus(task.id, userId, 'running'));
    expect(updated!.status).toBe('running');
    expect(ms).toBeLessThan(LIMITS.taskStatusChange);
  });
});

// ---------------------------------------------------------------------------
// 5e. PAT Operations
// ---------------------------------------------------------------------------

describe('Performance: PAT Operations', () => {
  let userId: string;

  beforeEach(async () => {
    const u = uid();
    const user = await createUser({ email: `pat_${u}@test.com`, username: `pat_${u}`, password: 'pass123' });
    userId = user.id;
  });

  it(`creates a PAT within ${LIMITS.patCreate}ms`, async () => {
    const [result, ms] = await timed(() =>
      createToken({ userId, name: 'Perf PAT', scopes: ['repo:read'], expiresInDays: 30 }),
    );
    expect(result.token).toBeTruthy();
    expect(ms).toBeLessThan(LIMITS.patCreate);
  });

  it(`validates a PAT within ${LIMITS.patValidate}ms`, async () => {
    const { token } = await createToken({ userId, name: 'Val PAT', scopes: ['repo:read'], expiresInDays: 30 });

    const [result, ms] = await timed(() => validateToken(token));
    expect(result.valid).toBe(true);
    expect(ms).toBeLessThan(LIMITS.patValidate);
  });

  it(`revokes a PAT within ${LIMITS.patRevoke}ms`, async () => {
    const { tokenInfo } = await createToken({ userId, name: 'Rev PAT', scopes: ['repo:read'], expiresInDays: 30 });

    const [, ms] = await timed(() => revokeToken(userId, tokenInfo.id));
    expect(ms).toBeLessThan(LIMITS.patRevoke);
  });
});

// ---------------------------------------------------------------------------
// 5f. Bulk Operations
// ---------------------------------------------------------------------------

describe('Performance: Bulk Operations', () => {
  let userId: string;
  let orgId: string;

  beforeEach(async () => {
    const u = uid();
    const user = await createUser({ email: `bulk_${u}@test.com`, username: `bulk_${u}`, password: 'pass123' });
    userId = user.id;
    const org = await createOrganization({ slug: `bulk-org-${u}`, name: 'Bulk Org', isPublic: true }, userId);
    orgId = org.id;
  });

  it(`creates 10 tasks sequentially within ${LIMITS.bulkCreate10}ms`, async () => {
    const [, ms] = await timed(async () => {
      for (let i = 0; i < 10; i++) {
        await createAgentTask({
          userId,
          title: `Bulk Task ${i}`,
          taskType: 'custom',
          priority: 'medium',
        });
      }
    });

    const tasks = await listAgentTasks({ userId });
    expect(tasks.length).toBe(10);
    expect(ms).toBeLessThan(LIMITS.bulkCreate10);
  });

  it('lists repos after creating multiple', async () => {
    const u = uid();
    for (let i = 0; i < 5; i++) {
      await createRepository(
        { slug: `bulk-r${i}-${u}`, name: `bulk-r${i}-${u}`, organizationId: orgId, visibility: 'internal' },
        userId,
      );
    }

    const [repos, ms] = await timed(() => getUserAccessibleRepositories(userId));
    expect(repos.length).toBe(5);
    expect(ms).toBeLessThan(LIMITS.repoList);
  });

  it('lists tokens after creating multiple', async () => {
    for (let i = 0; i < 5; i++) {
      await createToken({ userId, name: `Bulk PAT ${i}`, scopes: ['repo:read'], expiresInDays: 30 });
    }

    const [tokens, ms] = await timed(() => listTokens(userId));
    expect(tokens.length).toBe(5);
    expect(ms).toBeLessThan(LIMITS.patValidate);
  });
});
