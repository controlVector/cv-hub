/**
 * Executor Service Tests — sweepStaleExecutors
 *
 * Unit tests that mock the DB layer to verify sweep logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB before importing service ──────────────────────────────────
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();
const mockReturning = vi.fn();

vi.mock('../db', () => ({
  db: {
    update: (...args: any[]) => mockUpdate(...args),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'new-exec-id' }]),
      }),
    }),
    query: {
      agentExecutors: {
        findFirst: vi.fn(),
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
import { sweepStaleExecutors } from './executor.service';

describe('sweepStaleExecutors', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Chain: db.update().set().where().returning()
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ returning: mockReturning });
  });

  it('should mark stale executors as offline', async () => {
    mockReturning.mockResolvedValue([
      { id: 'exec-1' },
      { id: 'exec-2' },
    ]);

    const count = await sweepStaleExecutors(5);

    expect(count).toBe(2);
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'offline' }),
    );
  });

  it('should return 0 when no stale executors exist', async () => {
    mockReturning.mockResolvedValue([]);

    const count = await sweepStaleExecutors(5);

    expect(count).toBe(0);
  });

  it('should use the provided threshold in minutes', async () => {
    mockReturning.mockResolvedValue([{ id: 'exec-1' }]);

    const count = await sweepStaleExecutors(10);

    expect(count).toBe(1);
    // Verify update was called (threshold is used in the WHERE clause)
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('should default to 5 minutes threshold', async () => {
    mockReturning.mockResolvedValue([]);

    await sweepStaleExecutors();

    expect(mockUpdate).toHaveBeenCalled();
  });

  it('should propagate DB errors', async () => {
    mockReturning.mockRejectedValue(new Error('DB connection failed'));

    await expect(sweepStaleExecutors(5)).rejects.toThrow('DB connection failed');
  });
});
