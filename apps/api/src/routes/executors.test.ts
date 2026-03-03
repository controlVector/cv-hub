/**
 * Executor Routes Tests
 * Unit tests for resolveOrganizationId, task lifecycle (poll/start/complete/fail/heartbeat),
 * PATCH rename, and POST offline endpoint
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock services before importing routes ───────────────────────────
vi.mock('../services/organization.service', () => ({
  getUserOrgRole: vi.fn(),
  getUserOrganizations: vi.fn(),
}));

vi.mock('../services/executor.service', () => ({
  registerExecutor: vi.fn(),
  getExecutor: vi.fn(),
  listExecutors: vi.fn().mockResolvedValue([]),
  heartbeat: vi.fn(),
  updateExecutorStatus: vi.fn(),
  updateExecutor: vi.fn(),
  unregisterExecutor: vi.fn(),
  markExecutorTaskComplete: vi.fn(),
  sweepStaleExecutors: vi.fn(),
}));

vi.mock('../services/repository.service', () => ({
  getUserAccessibleRepositories: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/agent-task.service', () => ({
  claimNextTask: vi.fn(),
  startTask: vi.fn(),
  completeTask: vi.fn(),
  failTask: vi.fn(),
  taskHeartbeat: vi.fn(),
}));

// Mock auth middleware — auto-set userId
vi.mock('../middleware/auth', () => ({
  requireAuth: async (c: any, next: () => Promise<void>) => {
    c.set('userId', 'test-user-id');
    c.set('tokenScopes', ['repo:read', 'repo:write']);
    return next();
  },
}));

import { resolveOrganizationId, executorRoutes } from './executors';
import { getUserOrgRole, getUserOrganizations } from '../services/organization.service';
import { getExecutor, updateExecutorStatus, updateExecutor, registerExecutor, heartbeat, markExecutorTaskComplete } from '../services/executor.service';
import { claimNextTask, startTask, completeTask, failTask, taskHeartbeat } from '../services/agent-task.service';
import { getUserAccessibleRepositories } from '../services/repository.service';

const mockGetUserOrgRole = vi.mocked(getUserOrgRole);
const mockGetUserOrganizations = vi.mocked(getUserOrganizations);

const USER_ID = '00000000-0000-0000-0000-000000000001';
const ORG_A_ID = '00000000-0000-0000-0000-00000000000a';
const ORG_B_ID = '00000000-0000-0000-0000-00000000000b';

function fakeOrg(id: string, name: string, slug: string) {
  return {
    id,
    name,
    slug,
    description: null,
    avatarUrl: null,
    websiteUrl: null,
    isPublic: true,
    tierId: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    memberCount: 1,
    appCount: 0,
  } as any;
}

describe('resolveOrganizationId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses explicit org_id when user is a member', async () => {
    mockGetUserOrgRole.mockResolvedValue('member');

    const result = await resolveOrganizationId(USER_ID, ORG_A_ID);
    expect(result).toEqual({ orgId: ORG_A_ID });
    expect(mockGetUserOrgRole).toHaveBeenCalledWith(ORG_A_ID, USER_ID);
  });

  it('rejects explicit org_id when user is NOT a member', async () => {
    mockGetUserOrgRole.mockResolvedValue(null);

    const result = await resolveOrganizationId(USER_ID, ORG_A_ID);
    expect(result).toHaveProperty('error');
    expect(result.error!.message).toMatch(/not a member/);
  });

  it('uses PAT org scope when no explicit org_id', async () => {
    const result = await resolveOrganizationId(USER_ID, undefined, ORG_A_ID);
    expect(result).toEqual({ orgId: ORG_A_ID });
    // Should NOT call getUserOrganizations since PAT org is available
    expect(mockGetUserOrganizations).not.toHaveBeenCalled();
  });

  it('auto-resolves when user has exactly 1 org', async () => {
    mockGetUserOrganizations.mockResolvedValue([fakeOrg(ORG_A_ID, 'Org A', 'org-a')]);

    const result = await resolveOrganizationId(USER_ID);
    expect(result).toEqual({ orgId: ORG_A_ID });
  });

  it('returns undefined when user has 0 orgs', async () => {
    mockGetUserOrganizations.mockResolvedValue([]);

    const result = await resolveOrganizationId(USER_ID);
    expect(result).toEqual({ orgId: undefined });
  });

  it('returns error with org list when user has 2+ orgs', async () => {
    mockGetUserOrganizations.mockResolvedValue([
      fakeOrg(ORG_A_ID, 'Org A', 'org-a'),
      fakeOrg(ORG_B_ID, 'Org B', 'org-b'),
    ]);

    const result = await resolveOrganizationId(USER_ID);
    expect(result).toHaveProperty('error');
    expect(result.error!.message).toMatch(/Multiple organizations/);
    expect(result.error!.organizations).toHaveLength(2);
    expect(result.error!.organizations![0]).toEqual({ id: ORG_A_ID, name: 'Org A', slug: 'org-a' });
  });

  it('explicit org_id takes priority over PAT org', async () => {
    mockGetUserOrgRole.mockResolvedValue('owner');

    const result = await resolveOrganizationId(USER_ID, ORG_A_ID, ORG_B_ID);
    expect(result).toEqual({ orgId: ORG_A_ID });
    // Should use explicit, not PAT
    expect(mockGetUserOrgRole).toHaveBeenCalledWith(ORG_A_ID, USER_ID);
  });

  it('backward compat: explicit organization_id still accepted', async () => {
    // Same as first test — explicit org_id is the "backward compat" path
    mockGetUserOrgRole.mockResolvedValue('admin');

    const result = await resolveOrganizationId(USER_ID, ORG_B_ID);
    expect(result).toEqual({ orgId: ORG_B_ID });
  });
});

// ============================================================================
// Route-level tests (use Hono test client via executorRoutes.request)
// ============================================================================

const mockUpdateExecutorStatus = vi.mocked(updateExecutorStatus);
const mockUpdateExecutor = vi.mocked(updateExecutor);

describe('POST /:id/offline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should mark executor offline and return status', async () => {
    mockUpdateExecutorStatus.mockResolvedValue({
      id: 'exec-123',
      status: 'offline',
      name: 'test',
      machineName: null,
      type: 'claude_code',
      userId: 'test-user-id',
      capabilities: null,
      workspaceRoot: null,
      repos: null,
      organizationId: null,
      repositoryId: null,
      registrationToken: null,
      lastHeartbeatAt: null,
      lastTaskAt: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const res = await executorRoutes.request('/exec-123/offline', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.executor_id).toBe('exec-123');
    expect(body.status).toBe('offline');
    expect(mockUpdateExecutorStatus).toHaveBeenCalledWith('exec-123', 'test-user-id', 'offline');
  });

  it('should return 404 for unknown executor', async () => {
    mockUpdateExecutorStatus.mockResolvedValue(null);

    const res = await executorRoutes.request('/unknown-id/offline', {
      method: 'POST',
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Executor not found');
  });
});

describe('PATCH /:id (rename)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should rename executor and return updated data', async () => {
    mockUpdateExecutor.mockResolvedValue({
      id: 'exec-123',
      name: 'Renamed',
      machineName: 'my-machine',
      type: 'claude_code',
      status: 'online',
      repos: [],
      organizationId: null,
      updatedAt: new Date(),
    } as any);

    const res = await executorRoutes.request('/exec-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.executor.name).toBe('Renamed');
  });

  it('should return 404 for non-existent executor', async () => {
    mockUpdateExecutor.mockResolvedValue(null);

    const res = await executorRoutes.request('/nonexistent', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    });

    expect(res.status).toBe(404);
  });
});

// ============================================================================
// POST / (registration) — repository_id resolution
// ============================================================================

const mockRegisterExecutor = vi.mocked(registerExecutor);
const mockGetUserAccessibleRepositories = vi.mocked(getUserAccessibleRepositories);

describe('POST / (registration with repo resolution)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: org resolution returns no org
    mockGetUserOrganizations.mockResolvedValue([]);
  });

  it('should resolve repository_id from repos slug', async () => {
    mockGetUserAccessibleRepositories.mockResolvedValue([
      { id: 'repo-uuid-123', slug: 'cv-hub', name: 'cv-hub' } as any,
    ]);
    mockRegisterExecutor.mockResolvedValue({
      executor: {
        id: 'exec-1',
        name: 'test',
        machineName: 'z840',
        type: 'claude_code',
        status: 'online',
        repos: ['cv-hub'],
        organizationId: null,
        repositoryId: 'repo-uuid-123',
        createdAt: new Date(),
      } as any,
      registrationToken: 'tok-123',
    });

    const res = await executorRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'test',
        machine_name: 'z840',
        repos: ['cv-hub'],
      }),
    });

    expect(res.status).toBe(201);
    expect(mockRegisterExecutor).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: 'repo-uuid-123' }),
    );
  });

  it('should register without repository_id if repo not found', async () => {
    mockGetUserAccessibleRepositories.mockResolvedValue([]);
    mockRegisterExecutor.mockResolvedValue({
      executor: {
        id: 'exec-2',
        name: 'test',
        machineName: 'z840',
        type: 'claude_code',
        status: 'online',
        repos: ['unknown-repo'],
        organizationId: null,
        repositoryId: null,
        createdAt: new Date(),
      } as any,
      registrationToken: 'tok-456',
    });

    const res = await executorRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'test',
        machine_name: 'z840',
        repos: ['unknown-repo'],
      }),
    });

    expect(res.status).toBe(201);
    expect(mockRegisterExecutor).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: undefined }),
    );
  });

  it('should skip repo resolution if explicit repository_id provided', async () => {
    mockRegisterExecutor.mockResolvedValue({
      executor: {
        id: 'exec-3',
        name: 'test',
        machineName: 'z840',
        type: 'claude_code',
        status: 'online',
        repos: ['cv-hub'],
        organizationId: null,
        repositoryId: 'explicit-repo-id',
        createdAt: new Date(),
      } as any,
      registrationToken: 'tok-789',
    });

    const res = await executorRoutes.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'test',
        machine_name: 'z840',
        repos: ['cv-hub'],
        repository_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }),
    });

    expect(res.status).toBe(201);
    // Should NOT call getUserAccessibleRepositories since explicit ID was given
    expect(mockGetUserAccessibleRepositories).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Task lifecycle route tests (poll, start, complete, fail, heartbeat)
// ============================================================================

const EXEC_ID = 'eeee0000-0000-0000-0000-000000000001';
const TASK_ID = 'tttt0000-0000-0000-0000-000000000001';

const mockGetExecutor = vi.mocked(getExecutor);
const mockClaimNextTask = vi.mocked(claimNextTask);
const mockStartTask = vi.mocked(startTask);
const mockCompleteTask = vi.mocked(completeTask);
const mockFailTask = vi.mocked(failTask);
const mockTaskHeartbeat = vi.mocked(taskHeartbeat);
const mockHeartbeat = vi.mocked(heartbeat);
const mockMarkExecutorTaskComplete = vi.mocked(markExecutorTaskComplete);

const fakeExecutor = {
  id: EXEC_ID,
  userId: 'test-user-id',
  name: 'test-exec',
  machineName: 'z840',
  type: 'claude_code' as const,
  status: 'online' as const,
  capabilities: null,
  workspaceRoot: null,
  repos: null,
  organizationId: null,
  repositoryId: null,
  registrationToken: 'tok-abc',
  lastHeartbeatAt: new Date(),
  lastTaskAt: null,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const now = new Date();
const fakeTask = {
  id: TASK_ID,
  userId: 'test-user-id',
  executorId: EXEC_ID,
  threadId: null,
  title: 'Build the site',
  description: 'Full instructions here',
  taskType: 'code_change' as const,
  status: 'assigned' as const,
  priority: 'high' as const,
  input: { description: 'build it' },
  result: null,
  error: null,
  repositoryId: null,
  branch: 'main',
  filePaths: null,
  mcpSessionId: null,
  parentTaskId: null,
  metadata: null,
  startedAt: null,
  completedAt: null,
  timeoutAt: new Date(now.getTime() + 30 * 60 * 1000),
  createdAt: now,
  updatedAt: now,
};

describe('POST /:id/poll (claim task)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should claim a pending task and return it', async () => {
    mockGetExecutor.mockResolvedValue(fakeExecutor as any);
    mockHeartbeat.mockResolvedValue(fakeExecutor as any);
    mockClaimNextTask.mockResolvedValue(fakeTask as any);

    const res = await executorRoutes.request(`/${EXEC_ID}/poll`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task).toBeDefined();
    expect(body.task.id).toBe(TASK_ID);
    expect(body.task.title).toBe('Build the site');
    expect(body.task.priority).toBe('high');
  });

  it('should return null task when nothing pending', async () => {
    mockGetExecutor.mockResolvedValue(fakeExecutor as any);
    mockHeartbeat.mockResolvedValue(fakeExecutor as any);
    mockClaimNextTask.mockResolvedValue(null);

    const res = await executorRoutes.request(`/${EXEC_ID}/poll`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task).toBeNull();
    expect(body.message).toMatch(/No tasks/);
  });

  it('should return 404 for unknown executor', async () => {
    mockGetExecutor.mockResolvedValue(null);

    const res = await executorRoutes.request('/unknown-exec/poll', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('POST /:id/tasks/:taskId/start', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should mark task as running', async () => {
    mockGetExecutor.mockResolvedValue(fakeExecutor as any);
    mockStartTask.mockResolvedValue({ ...fakeTask, status: 'running', startedAt: now } as any);

    const res = await executorRoutes.request(`/${EXEC_ID}/tasks/${TASK_ID}/start`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('running');
    expect(body.started_at).toBeDefined();
  });

  it('should return 404 for task not assigned to this executor', async () => {
    mockGetExecutor.mockResolvedValue(fakeExecutor as any);
    mockStartTask.mockResolvedValue(null);

    const res = await executorRoutes.request(`/${EXEC_ID}/tasks/${TASK_ID}/start`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('POST /:id/tasks/:taskId/complete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should complete task with result', async () => {
    mockGetExecutor.mockResolvedValue(fakeExecutor as any);
    mockCompleteTask.mockResolvedValue({
      ...fakeTask,
      status: 'completed',
      result: { summary: 'Built 7 files' },
      completedAt: now,
    } as any);
    mockMarkExecutorTaskComplete.mockResolvedValue(undefined as any);

    const res = await executorRoutes.request(`/${EXEC_ID}/tasks/${TASK_ID}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: 'Built 7 files', files_modified: ['index.ts'] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('completed');
    expect(body.completed_at).toBeDefined();
    expect(mockMarkExecutorTaskComplete).toHaveBeenCalledWith(EXEC_ID);
  });

  it('should return 404 when task not assigned to executor', async () => {
    mockGetExecutor.mockResolvedValue(fakeExecutor as any);
    mockCompleteTask.mockResolvedValue(null);

    const res = await executorRoutes.request(`/${EXEC_ID}/tasks/${TASK_ID}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: 'done' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('POST /:id/tasks/:taskId/fail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should fail task with error', async () => {
    mockGetExecutor.mockResolvedValue(fakeExecutor as any);
    mockFailTask.mockResolvedValue({
      ...fakeTask,
      status: 'failed',
      error: 'Build failed: missing dep',
      completedAt: now,
    } as any);
    mockMarkExecutorTaskComplete.mockResolvedValue(undefined as any);

    const res = await executorRoutes.request(`/${EXEC_ID}/tasks/${TASK_ID}/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Build failed: missing dep' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.error).toBe('Build failed: missing dep');
    expect(mockMarkExecutorTaskComplete).toHaveBeenCalledWith(EXEC_ID);
  });

  it('should return 404 for wrong executor', async () => {
    mockGetExecutor.mockResolvedValue(fakeExecutor as any);
    mockFailTask.mockResolvedValue(null);

    const res = await executorRoutes.request(`/${EXEC_ID}/tasks/${TASK_ID}/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'some error' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('POST /:id/tasks/:taskId/heartbeat', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should update task activity timestamp', async () => {
    const updatedAt = new Date();
    mockGetExecutor.mockResolvedValue(fakeExecutor as any);
    mockTaskHeartbeat.mockResolvedValue({ ...fakeTask, updatedAt } as any);

    const res = await executorRoutes.request(`/${EXEC_ID}/tasks/${TASK_ID}/heartbeat`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task_id).toBe(TASK_ID);
    expect(body.status).toBe('assigned');
    expect(body.updated_at).toBeDefined();
  });

  it('should return 404 for task not assigned to executor', async () => {
    mockGetExecutor.mockResolvedValue(fakeExecutor as any);
    mockTaskHeartbeat.mockResolvedValue(null);

    const res = await executorRoutes.request(`/${EXEC_ID}/tasks/${TASK_ID}/heartbeat`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
