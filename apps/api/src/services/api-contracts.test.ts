/**
 * API Response Contract Tests (Sprint 8 — Step 4)
 *
 * Verifies that service-layer return values contain the exact fields
 * that route handlers depend on when building JSON responses.
 *
 * 4a. User / Auth contracts — createUser, authenticateUser field shapes
 * 4b. Organization contracts — createOrganization, getUserOrganizations, member shapes
 * 4c. Repository contracts — createRepository, getUserAccessibleRepositories shapes
 * 4d. Task contracts — createAgentTask, listAgentTasks, getAgentTask shapes
 * 4e. PAT contracts — createToken, validateToken, listTokens shapes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createUser, authenticateUser } from './user.service';
import {
  createOrganization,
  getUserOrganizations,
  listOrganizationMembers,
  createInvite,
  acceptInviteByToken,
} from './organization.service';
import {
  createRepository,
  getUserAccessibleRepositories,
  canUserAccessRepo,
} from './repository.service';
import {
  createAgentTask,
  listAgentTasks,
  getAgentTask,
  updateAgentTaskStatus,
  cancelAgentTask,
} from './agent-task.service';
import { createToken, validateToken, listTokens, revokeToken } from './pat.service';
import { truncateAllTables } from '../test/test-db';

let seq = 0;
function uid() { return `ct_${Date.now()}_${++seq}`; }

// ---------------------------------------------------------------------------
// 4a. User / Auth Contracts
// ---------------------------------------------------------------------------

describe('User / Auth Response Contracts', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('createUser returns full AuthenticatedUser shape', async () => {
    const u = uid();
    const user = await createUser({
      email: `shape_${u}@test.com`,
      username: `shape_${u}`,
      password: 'pass123',
    });

    // Fields the auth route depends on (POST /api/auth/register → c.json({ user }))
    expect(user).toMatchObject({
      id: expect.any(String),
      username: `shape_${u}`,
      email: `shape_${u}@test.com`,
      displayName: expect.any(String),
      avatarUrl: expect.any(String),
      emailVerified: expect.any(Boolean),
      mfaEnabled: expect.any(Boolean),
      isAdmin: expect.any(Boolean),
    });
    expect(user.createdAt).toBeTruthy();
    expect(user.updatedAt).toBeTruthy();
  });

  it('authenticateUser returns same AuthenticatedUser shape', async () => {
    const u = uid();
    await createUser({
      email: `auth_${u}@test.com`,
      username: `auth_${u}`,
      password: 'pass123',
    });

    const authed = await authenticateUser(`auth_${u}@test.com`, 'pass123');

    expect(authed).toMatchObject({
      id: expect.any(String),
      username: `auth_${u}`,
      email: `auth_${u}@test.com`,
      displayName: expect.any(String),
      emailVerified: expect.any(Boolean),
      mfaEnabled: expect.any(Boolean),
      isAdmin: expect.any(Boolean),
    });
  });
});

// ---------------------------------------------------------------------------
// 4b. Organization Contracts
// ---------------------------------------------------------------------------

describe('Organization Response Contracts', () => {
  let userId: string;

  beforeEach(async () => {
    await truncateAllTables();
    const u = uid();
    const user = await createUser({ email: `org_${u}@test.com`, username: `org_${u}`, password: 'pass123' });
    userId = user.id;
  });

  it('createOrganization returns full Organization shape', async () => {
    const u = uid();
    const org = await createOrganization(
      { slug: `ct-org-${u}`, name: 'Contract Org', description: 'Test', isPublic: true },
      userId,
    );

    // Fields the org route depends on (POST /api/v1/orgs → c.json({ organization }))
    expect(org).toMatchObject({
      id: expect.any(String),
      slug: `ct-org-${u}`,
      name: 'Contract Org',
      description: 'Test',
      isPublic: true,
    });
    expect(org.createdAt).toBeTruthy();
    expect(org.updatedAt).toBeTruthy();

    // Enterprise fields should exist (even if null/default)
    expect(org).toHaveProperty('logoUrl');
    expect(org).toHaveProperty('websiteUrl');
    expect(org).toHaveProperty('instanceType');
    expect(org).toHaveProperty('ssoEnabled');
    expect(org).toHaveProperty('ssoEnforced');
    expect(org).toHaveProperty('isVerified');
  });

  it('getUserOrganizations returns array of Organization objects', async () => {
    const u = uid();
    await createOrganization({ slug: `list-org-${u}`, name: 'List Org', isPublic: true }, userId);

    const orgs = await getUserOrganizations(userId);
    expect(Array.isArray(orgs)).toBe(true);
    expect(orgs.length).toBeGreaterThanOrEqual(1);

    const org = orgs[0];
    expect(org).toHaveProperty('id');
    expect(org).toHaveProperty('slug');
    expect(org).toHaveProperty('name');
    expect(org).toHaveProperty('isPublic');
  });

  it('listOrganizationMembers returns member shapes with role', async () => {
    const u = uid();
    const org = await createOrganization({ slug: `mem-org-${u}`, name: 'Mem Org', isPublic: true }, userId);

    const members = await listOrganizationMembers(org.id);
    expect(Array.isArray(members)).toBe(true);
    expect(members.length).toBe(1);

    const member = members[0];
    expect(member).toHaveProperty('userId');
    expect(member).toHaveProperty('role');
    expect(member).toHaveProperty('organizationId');
    expect(['owner', 'admin', 'member']).toContain(member.role);
  });

  it('createInvite returns invite with token and email', async () => {
    const u = uid();
    const org = await createOrganization({ slug: `inv-org-${u}`, name: 'Inv Org', isPublic: true }, userId);

    const invite = await createInvite(org.id, `invitee_${u}@test.com`, 'member', userId);

    expect(invite).toMatchObject({
      email: `invitee_${u}@test.com`,
      role: 'member',
    });
    expect(invite.token).toBeTruthy();
    expect(typeof invite.token).toBe('string');
    expect(invite).toHaveProperty('id');
    expect(invite).toHaveProperty('organizationId');
    expect(invite).toHaveProperty('expiresAt');
    // Pending = acceptedAt is null
    expect(invite.acceptedAt).toBeNull();
  });

  it('acceptInviteByToken returns membership shape', async () => {
    const u = uid();
    const org = await createOrganization({ slug: `acc-org-${u}`, name: 'Acc Org', isPublic: true }, userId);
    const invitee = await createUser({ email: `acc_${u}@test.com`, username: `acc_${u}`, password: 'pass123' });
    const invite = await createInvite(org.id, `acc_${u}@test.com`, 'member', userId);

    const membership = await acceptInviteByToken(invite.token, invitee.id, `acc_${u}@test.com`);

    expect(membership).toMatchObject({
      userId: invitee.id,
      organizationId: org.id,
      role: 'member',
    });
  });
});

// ---------------------------------------------------------------------------
// 4c. Repository Contracts
// ---------------------------------------------------------------------------

describe('Repository Response Contracts', () => {
  let userId: string;
  let orgId: string;

  beforeEach(async () => {
    await truncateAllTables();
    const u = uid();
    const user = await createUser({ email: `repo_${u}@test.com`, username: `repo_${u}`, password: 'pass123' });
    userId = user.id;
    const org = await createOrganization({ slug: `repo-org-${u}`, name: 'Repo Org', isPublic: true }, userId);
    orgId = org.id;
  });

  it('createRepository returns full Repository shape', async () => {
    const u = uid();
    const repo = await createRepository(
      { slug: `ct-repo-${u}`, name: `ct-repo-${u}`, organizationId: orgId, visibility: 'private' },
      userId,
    );

    // Fields the repo route depends on (POST /api/v1/repos → c.json({ repository }, 201))
    expect(repo).toMatchObject({
      id: expect.any(String),
      slug: `ct-repo-${u}`,
      name: `ct-repo-${u}`,
      organizationId: orgId,
      visibility: 'private',
      provider: 'local',
      defaultBranch: 'main',
    });

    // Statistics fields (defaults)
    expect(repo.starCount).toBe(0);
    expect(repo.watcherCount).toBe(0);
    expect(repo.forkCount).toBe(0);
    expect(repo.openIssueCount).toBe(0);
    expect(repo.openPrCount).toBe(0);

    // Settings fields
    expect(typeof repo.hasIssues).toBe('boolean');
    expect(typeof repo.hasPullRequests).toBe('boolean');
    expect(typeof repo.hasWiki).toBe('boolean');

    // Graph sync fields
    expect(repo.graphSyncStatus).toBe('pending');

    // Archive fields
    expect(repo.isArchived).toBe(false);

    // Timestamps
    expect(repo.createdAt).toBeTruthy();
    expect(repo.updatedAt).toBeTruthy();
  });

  it('getUserAccessibleRepositories returns array of Repository objects', async () => {
    const u = uid();
    await createRepository(
      { slug: `acc-repo-${u}`, name: `acc-repo-${u}`, organizationId: orgId, visibility: 'internal' },
      userId,
    );

    const repos = await getUserAccessibleRepositories(userId);
    expect(Array.isArray(repos)).toBe(true);
    expect(repos.length).toBeGreaterThanOrEqual(1);

    const repo = repos[0];
    expect(repo).toHaveProperty('id');
    expect(repo).toHaveProperty('slug');
    expect(repo).toHaveProperty('name');
    expect(repo).toHaveProperty('visibility');
    expect(repo).toHaveProperty('organizationId');
  });

  it('canUserAccessRepo returns boolean', async () => {
    const u = uid();
    const repo = await createRepository(
      { slug: `bool-repo-${u}`, name: `bool-repo-${u}`, organizationId: orgId, visibility: 'private' },
      userId,
    );

    const result = await canUserAccessRepo(repo.id, userId);
    expect(typeof result).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// 4d. Task Contracts
// ---------------------------------------------------------------------------

describe('Task Response Contracts', () => {
  let userId: string;

  beforeEach(async () => {
    await truncateAllTables();
    const u = uid();
    const user = await createUser({ email: `task_${u}@test.com`, username: `task_${u}`, password: 'pass123' });
    userId = user.id;
  });

  it('createAgentTask returns full AgentTask shape', async () => {
    const task = await createAgentTask({
      userId,
      title: 'Contract Test Task',
      description: 'Verify shape',
      taskType: 'debug',
      priority: 'high',
    });

    // Fields the task route maps to snake_case (POST /api/v1/tasks → task: { id, title, ... })
    expect(task).toMatchObject({
      id: expect.any(String),
      userId,
      title: 'Contract Test Task',
      description: 'Verify shape',
      taskType: 'debug',
      status: 'pending',
      priority: 'high',
    });
    expect(task.createdAt).toBeTruthy();

    // Nullable fields exist on the object
    expect(task).toHaveProperty('executorId');
    expect(task).toHaveProperty('threadId');
    expect(task).toHaveProperty('repositoryId');
    expect(task).toHaveProperty('branch');
    expect(task).toHaveProperty('result');
    expect(task).toHaveProperty('error');
    expect(task).toHaveProperty('metadata');
    expect(task).toHaveProperty('startedAt');
    expect(task).toHaveProperty('completedAt');
  });

  it('listAgentTasks returns array with correct camelCase fields', async () => {
    await createAgentTask({
      userId,
      title: 'List Test',
      taskType: 'review',
      priority: 'medium',
    });

    const tasks = await listAgentTasks({ userId });
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThanOrEqual(1);

    const task = tasks[0];
    // Route handler reads these camelCase fields and converts to snake_case
    expect(task).toHaveProperty('id');
    expect(task).toHaveProperty('title');
    expect(task).toHaveProperty('taskType');       // → task_type in JSON
    expect(task).toHaveProperty('status');
    expect(task).toHaveProperty('priority');
    expect(task).toHaveProperty('repositoryId');   // → repository_id in JSON
    expect(task).toHaveProperty('executorId');      // → executor_id in JSON
    expect(task).toHaveProperty('threadId');        // → thread_id in JSON
    expect(task).toHaveProperty('startedAt');       // → started_at in JSON
    expect(task).toHaveProperty('completedAt');     // → completed_at in JSON
    expect(task).toHaveProperty('createdAt');       // → created_at in JSON
    expect(task).toHaveProperty('updatedAt');       // → updated_at in JSON
  });

  it('getAgentTask returns single task with all detail fields', async () => {
    const created = await createAgentTask({
      userId,
      title: 'Detail Test',
      taskType: 'code_change',
      priority: 'low',
    });

    const task = await getAgentTask(created.id, userId);
    expect(task).toBeDefined();

    // Detail endpoint includes additional fields beyond list
    expect(task).toHaveProperty('input');
    expect(task).toHaveProperty('filePaths');       // → file_paths in JSON
    expect(task).toHaveProperty('parentTaskId');     // → parent_task_id in JSON
    expect(task).toHaveProperty('timeoutAt');        // → timeout_at in JSON
  });

  it('updateAgentTaskStatus returns updated task with timestamp', async () => {
    const created = await createAgentTask({
      userId,
      title: 'Status Test',
      taskType: 'deploy',
      priority: 'critical',
    });

    // Move to running — should set startedAt
    const running = await updateAgentTaskStatus(created.id, userId, 'running');
    expect(running).toBeDefined();
    expect(running!.status).toBe('running');
    expect(running!.startedAt).toBeTruthy();

    // Complete — should set completedAt
    const completed = await updateAgentTaskStatus(created.id, userId, 'completed');
    expect(completed).toBeDefined();
    expect(completed!.status).toBe('completed');
    expect(completed!.completedAt).toBeTruthy();
  });

  it('cancelAgentTask returns task with cancelled status', async () => {
    const created = await createAgentTask({
      userId,
      title: 'Cancel Test',
      taskType: 'test',
      priority: 'medium',
    });

    const cancelled = await cancelAgentTask(created.id, userId);
    expect(cancelled).toBeDefined();
    expect(cancelled!.status).toBe('cancelled');
    expect(cancelled!).toHaveProperty('id');
  });
});

// ---------------------------------------------------------------------------
// 4e. PAT Contracts
// ---------------------------------------------------------------------------

describe('PAT Response Contracts', () => {
  let userId: string;

  beforeEach(async () => {
    await truncateAllTables();
    const u = uid();
    const user = await createUser({ email: `pat_${u}@test.com`, username: `pat_${u}`, password: 'pass123' });
    userId = user.id;
  });

  it('createToken returns { token, tokenInfo } shape', async () => {
    const result = await createToken({
      userId,
      name: 'Contract PAT',
      scopes: ['repo:read', 'repo:write'],
      expiresInDays: 30,
    });

    // Top-level structure (route returns { token, tokenInfo, warning })
    expect(result).toHaveProperty('token');
    expect(result).toHaveProperty('tokenInfo');
    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBeGreaterThan(0);

    // TokenInfo shape
    const info = result.tokenInfo;
    expect(info).toMatchObject({
      id: expect.any(String),
      name: 'Contract PAT',
      tokenPrefix: expect.any(String),
      scopes: expect.arrayContaining(['repo:read', 'repo:write']),
      isExpired: false,
      isRevoked: false,
    });
    expect(info.createdAt).toBeTruthy();
    expect(info).toHaveProperty('organizationId');
    expect(info).toHaveProperty('expiresAt');
    expect(info).toHaveProperty('lastUsedAt');
  });

  it('validateToken returns { valid, userId, scopes } shape', async () => {
    const { token } = await createToken({
      userId,
      name: 'Validate PAT',
      scopes: ['repo:read'],
      expiresInDays: 30,
    });

    const result = await validateToken(token);

    expect(result).toMatchObject({
      valid: true,
      userId,
    });
    expect(result.scopes).toContain('repo:read');
  });

  it('validateToken returns { valid: false } for invalid token', async () => {
    const result = await validateToken('cv_pat_invalid_token_abc');

    expect(result.valid).toBe(false);
    // userId and scopes should be undefined for invalid tokens
    expect(result.userId).toBeUndefined();
  });

  it('listTokens returns array of TokenInfo objects', async () => {
    await createToken({
      userId,
      name: 'List PAT 1',
      scopes: ['repo:read'],
      expiresInDays: 30,
    });
    await createToken({
      userId,
      name: 'List PAT 2',
      scopes: ['user:read'],
      expiresInDays: 30,
    });

    const tokens = await listTokens(userId);
    expect(Array.isArray(tokens)).toBe(true);
    expect(tokens.length).toBeGreaterThanOrEqual(2);

    // Each entry matches TokenInfo shape
    for (const t of tokens) {
      expect(t).toHaveProperty('id');
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('tokenPrefix');
      expect(t).toHaveProperty('scopes');
      expect(t).toHaveProperty('isExpired');
      expect(t).toHaveProperty('isRevoked');
      expect(t).toHaveProperty('createdAt');
      // Full token string is NOT present in list
      expect(t).not.toHaveProperty('token');
    }
  });

  it('revokeToken makes token invalid on subsequent validate', async () => {
    const { token, tokenInfo } = await createToken({
      userId,
      name: 'Revoke PAT',
      scopes: ['repo:read'],
      expiresInDays: 30,
    });

    await revokeToken(userId, tokenInfo.id);

    const result = await validateToken(token);
    expect(result.valid).toBe(false);
  });
});
