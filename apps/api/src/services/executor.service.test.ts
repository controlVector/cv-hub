/**
 * Executor Service Tests
 *
 * Unit tests that mock the DB layer to verify:
 *  - sweepStaleExecutors logic
 *  - registerExecutor upsert behavior
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB before importing service ──────────────────────────────────
const mockUpdateFn = vi.fn();
const mockSetFn = vi.fn();
const mockWhereFn = vi.fn();
const mockReturningFn = vi.fn();
const mockInsertFn = vi.fn();
const mockValuesFn = vi.fn();
const mockInsertReturningFn = vi.fn();
const mockFindFirst = vi.fn();

vi.mock('../db', () => ({
  db: {
    update: (...args: any[]) => mockUpdateFn(...args),
    insert: (...args: any[]) => mockInsertFn(...args),
    query: {
      agentExecutors: {
        findFirst: (...args: any[]) => mockFindFirst(...args),
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  },
}));

vi.mock('../db/schema', () => ({
  agentExecutors: {
    id: 'id',
    userId: 'user_id',
    status: 'status',
    lastHeartbeatAt: 'last_heartbeat_at',
    name: 'name',
    machineName: 'machine_name',
    type: 'type',
    capabilities: 'capabilities',
    workspaceRoot: 'workspace_root',
    repos: 'repos',
    organizationId: 'organization_id',
    repositoryId: 'repository_id',
    registrationToken: 'registration_token',
    lastTaskAt: 'last_task_at',
    updatedAt: 'updated_at',
    createdAt: 'created_at',
    metadata: 'metadata',
  },
}));

vi.mock('../utils/crypto', () => ({
  generateSecureToken: vi.fn().mockReturnValue('mock-token-abc'),
}));

// Import after mocks
import { sweepStaleExecutors, registerExecutor } from './executor.service';

// ── Helpers ───────────────────────────────────────────────────────────

function setupUpdateChain() {
  mockUpdateFn.mockReturnValue({ set: mockSetFn });
  mockSetFn.mockReturnValue({ where: mockWhereFn });
  mockWhereFn.mockReturnValue({ returning: mockReturningFn });
}

function setupInsertChain() {
  mockInsertFn.mockReturnValue({ values: mockValuesFn });
  mockValuesFn.mockReturnValue({ returning: mockInsertReturningFn });
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('sweepStaleExecutors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupUpdateChain();
  });

  it('should mark stale executors as offline', async () => {
    mockReturningFn.mockResolvedValue([{ id: 'exec-1' }, { id: 'exec-2' }]);

    const count = await sweepStaleExecutors(5);

    expect(count).toBe(2);
    expect(mockUpdateFn).toHaveBeenCalled();
    expect(mockSetFn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'offline' }),
    );
  });

  it('should return 0 when no stale executors exist', async () => {
    mockReturningFn.mockResolvedValue([]);
    expect(await sweepStaleExecutors(5)).toBe(0);
  });

  it('should use the provided threshold in minutes', async () => {
    mockReturningFn.mockResolvedValue([{ id: 'exec-1' }]);
    expect(await sweepStaleExecutors(10)).toBe(1);
    expect(mockUpdateFn).toHaveBeenCalled();
  });

  it('should default to 5 minutes threshold', async () => {
    mockReturningFn.mockResolvedValue([]);
    await sweepStaleExecutors();
    expect(mockUpdateFn).toHaveBeenCalled();
  });

  it('should propagate DB errors', async () => {
    mockReturningFn.mockRejectedValue(new Error('DB connection failed'));
    await expect(sweepStaleExecutors(5)).rejects.toThrow('DB connection failed');
  });
});

describe('registerExecutor — upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupUpdateChain();
    setupInsertChain();
  });

  it('should update existing executor when machineName matches', async () => {
    const existingExec = {
      id: 'existing-id',
      userId: 'user-1',
      machineName: 'z840-primary',
      registrationToken: 'old-token',
      organizationId: 'org-1',
      repositoryId: null,
    };
    mockFindFirst.mockResolvedValue(existingExec);
    mockReturningFn.mockResolvedValue([{
      ...existingExec,
      name: 'claude-code:z840-primary:abc123',
      status: 'online',
    }]);

    const result = await registerExecutor({
      userId: 'user-1',
      name: 'claude-code:z840-primary:abc123',
      machineName: 'z840-primary',
    });

    // Should NOT insert
    expect(mockInsertFn).not.toHaveBeenCalled();
    // Should update
    expect(mockUpdateFn).toHaveBeenCalled();
    expect(mockSetFn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'online' }),
    );
    // Should return existing token
    expect(result.registrationToken).toBe('old-token');
  });

  it('should insert new executor when machineName does NOT match', async () => {
    mockFindFirst.mockResolvedValue(null); // No existing match
    mockInsertReturningFn.mockResolvedValue([{
      id: 'new-id',
      name: 'claude-code:new-machine:abc123',
      machineName: 'new-machine',
      status: 'online',
    }]);

    const result = await registerExecutor({
      userId: 'user-1',
      name: 'claude-code:new-machine:abc123',
      machineName: 'new-machine',
    });

    expect(mockInsertFn).toHaveBeenCalled();
    expect(result.executor.id).toBe('new-id');
    expect(result.registrationToken).toBe('mock-token-abc');
  });

  it('should insert new executor when no machineName provided', async () => {
    mockInsertReturningFn.mockResolvedValue([{
      id: 'new-id',
      name: 'some-executor',
      status: 'online',
    }]);

    const result = await registerExecutor({
      userId: 'user-1',
      name: 'some-executor',
      // no machineName — skip upsert logic
    });

    // findFirst should NOT be called (no machineName to match on)
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockInsertFn).toHaveBeenCalled();
    expect(result.executor.id).toBe('new-id');
  });

  it('should preserve existing orgId when not provided in upsert', async () => {
    const existingExec = {
      id: 'existing-id',
      userId: 'user-1',
      machineName: 'z840-primary',
      registrationToken: 'tok',
      organizationId: 'org-from-before',
      repositoryId: 'repo-from-before',
    };
    mockFindFirst.mockResolvedValue(existingExec);
    mockReturningFn.mockResolvedValue([{ ...existingExec, status: 'online' }]);

    await registerExecutor({
      userId: 'user-1',
      name: 'test',
      machineName: 'z840-primary',
      // No organizationId or repositoryId — should keep existing
    });

    expect(mockSetFn).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-from-before',
        repositoryId: 'repo-from-before',
      }),
    );
  });
});
