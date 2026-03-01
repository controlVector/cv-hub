/**
 * Session Binding Tests (Sprint 9 — Step 1+2)
 *
 * Tests for session_bindings table operations, executor machine_name
 * support, and binding/unbinding lifecycle.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createUser } from './user.service';
import { createOrganization } from './organization.service';
import { registerExecutor, heartbeat, updateExecutorStatus } from './executor.service';
import {
  bindSession,
  unbindSession,
  getActiveBinding,
  resolveExecutorForDispatch,
} from './session-binding.service';
import { db } from '../db';
import { mcpSessions, agentExecutors } from '../db/schema';
import { generateSecureToken } from '../utils/crypto';

let seq = 0;
function uid() { return `sb_${Date.now()}_${++seq}`; }

/** Helper: create user + org + executor (online) */
async function setupExecutor(opts?: { machineName?: string; repos?: string[] }) {
  const u = uid();
  const user = await createUser({
    email: `${u}@test.com`,
    username: u,
    password: 'pass123',
  });
  const org = await createOrganization(
    { slug: `org-${u}`, name: `Org ${u}`, isPublic: true },
    user.id,
  );
  const { executor } = await registerExecutor({
    userId: user.id,
    name: `claude-code:${u}:abc123`,
    type: 'claude_code',
    machineName: opts?.machineName,
    repos: opts?.repos,
    organizationId: org.id,
  });
  return { user, org, executor };
}

/** Helper: create an MCP session record directly */
async function createMcpSession(userId: string): Promise<string> {
  const token = generateSecureToken(32);
  const [session] = await db
    .insert(mcpSessions)
    .values({
      sessionToken: token,
      userId,
      transport: 'streamable_http',
      status: 'active',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returning();
  return session.id;
}

// ---------------------------------------------------------------------------
// Schema: executor machine_name and repos
// ---------------------------------------------------------------------------

describe('Executor Machine Name & Repos', () => {
  it('stores machineName on executor registration', async () => {
    const { executor } = await setupExecutor({ machineName: 'z840-primary' });
    expect(executor.machineName).toBe('z840-primary');
  });

  it('stores repos list on executor registration', async () => {
    const { executor } = await setupExecutor({
      machineName: 'dev-box',
      repos: ['cv-hub', 'cv-git', 'nyx-core'],
    });
    expect(executor.repos).toEqual(['cv-hub', 'cv-git', 'nyx-core']);
  });

  it('machineName defaults to null when not provided', async () => {
    const { executor } = await setupExecutor();
    expect(executor.machineName).toBeNull();
  });

  it('stores organizationId on executor', async () => {
    const { executor, org } = await setupExecutor({ machineName: 'test' });
    expect(executor.organizationId).toBe(org.id);
  });
});

// ---------------------------------------------------------------------------
// Session Binding: create / unique constraint
// ---------------------------------------------------------------------------

describe('Session Binding Lifecycle', () => {
  it('creates a binding between MCP session and executor', async () => {
    const { user, org, executor } = await setupExecutor({ machineName: 'test-machine' });
    const sessionId = await createMcpSession(user.id);

    const binding = await bindSession({
      mcpSessionId: sessionId,
      executorId: executor.id,
      userId: user.id,
      organizationId: org.id,
    });

    expect(binding.id).toBeTruthy();
    expect(binding.mcpSessionId).toBe(sessionId);
    expect(binding.executorId).toBe(executor.id);
    expect(binding.userId).toBe(user.id);
    expect(binding.organizationId).toBe(org.id);
    expect(binding.boundAt).toBeInstanceOf(Date);
    expect(binding.unboundAt).toBeNull();
  });

  it('enforces one active binding per MCP session', async () => {
    const { user, org, executor } = await setupExecutor({ machineName: 'machine-a' });
    const sessionId = await createMcpSession(user.id);

    await bindSession({
      mcpSessionId: sessionId,
      executorId: executor.id,
      userId: user.id,
      organizationId: org.id,
    });

    await expect(
      bindSession({
        mcpSessionId: sessionId,
        executorId: executor.id,
        userId: user.id,
        organizationId: org.id,
      }),
    ).rejects.toThrow(/already connected/i);
  });

  it('unbinds a session by setting unbound_at', async () => {
    const { user, org, executor } = await setupExecutor({ machineName: 'unbind-test' });
    const sessionId = await createMcpSession(user.id);

    await bindSession({
      mcpSessionId: sessionId,
      executorId: executor.id,
      userId: user.id,
      organizationId: org.id,
    });

    const unbound = await unbindSession(sessionId, user.id);
    expect(unbound).not.toBeNull();
    expect(unbound!.unboundAt).toBeInstanceOf(Date);
  });

  it('allows rebinding after unbinding', async () => {
    const { user, org, executor } = await setupExecutor({ machineName: 'rebind-a' });
    const setup2 = await setupExecutor({ machineName: 'rebind-b' });
    const sessionId = await createMcpSession(user.id);

    // Bind to first executor
    await bindSession({
      mcpSessionId: sessionId,
      executorId: executor.id,
      userId: user.id,
      organizationId: org.id,
    });

    // Unbind
    await unbindSession(sessionId, user.id);

    // Rebind to second executor (same user, different machine setup — but
    // for simplicity in test we use the same session with a different executor)
    // Note: setup2's executor belongs to a different user, so we create one
    // that belongs to the original user.
    const { executor: exec2 } = await registerExecutor({
      userId: user.id,
      name: 'claude-code:rebind:xyz',
      machineName: 'rebind-target',
      organizationId: org.id,
    });

    const binding = await bindSession({
      mcpSessionId: sessionId,
      executorId: exec2.id,
      userId: user.id,
      organizationId: org.id,
    });
    expect(binding.executorId).toBe(exec2.id);
  });

  it('rejects binding to offline executor', async () => {
    const { user, org, executor } = await setupExecutor({ machineName: 'offline-box' });
    await updateExecutorStatus(executor.id, user.id, 'offline');
    const sessionId = await createMcpSession(user.id);

    await expect(
      bindSession({
        mcpSessionId: sessionId,
        executorId: executor.id,
        userId: user.id,
        organizationId: org.id,
      }),
    ).rejects.toThrow(/offline/i);
  });

  it('rejects binding to another user\'s executor', async () => {
    const { user, org, executor } = await setupExecutor({ machineName: 'user-a-box' });
    const u2 = uid();
    const user2 = await createUser({
      email: `${u2}@test.com`,
      username: u2,
      password: 'pass123',
    });
    const sessionId = await createMcpSession(user2.id);

    await expect(
      bindSession({
        mcpSessionId: sessionId,
        executorId: executor.id,
        userId: user2.id,
        organizationId: org.id,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('getActiveBinding returns binding with executor details', async () => {
    const { user, org, executor } = await setupExecutor({ machineName: 'query-test' });
    const sessionId = await createMcpSession(user.id);

    await bindSession({
      mcpSessionId: sessionId,
      executorId: executor.id,
      userId: user.id,
      organizationId: org.id,
    });

    const active = await getActiveBinding(sessionId);
    expect(active).not.toBeNull();
    expect(active!.executor.id).toBe(executor.id);
    expect(active!.executor.machineName).toBe('query-test');
  });

  it('getActiveBinding returns null after unbinding', async () => {
    const { user, org, executor } = await setupExecutor({ machineName: 'unbind-query' });
    const sessionId = await createMcpSession(user.id);

    await bindSession({
      mcpSessionId: sessionId,
      executorId: executor.id,
      userId: user.id,
      organizationId: org.id,
    });
    await unbindSession(sessionId, user.id);

    const active = await getActiveBinding(sessionId);
    expect(active).toBeNull();
  });

  it('unbindSession returns null when no active binding', async () => {
    const { user } = await setupExecutor();
    const sessionId = await createMcpSession(user.id);

    const result = await unbindSession(sessionId, user.id);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dispatch Resolution
// ---------------------------------------------------------------------------

describe('Dispatch Resolution', () => {
  it('resolves to bound executor when binding exists', async () => {
    const { user, org, executor } = await setupExecutor({ machineName: 'bound-machine' });
    const sessionId = await createMcpSession(user.id);

    await bindSession({
      mcpSessionId: sessionId,
      executorId: executor.id,
      userId: user.id,
      organizationId: org.id,
    });

    const result = await resolveExecutorForDispatch(sessionId, user.id);
    expect(result.viaBind).toBe(true);
    expect(result.executor.id).toBe(executor.id);
  });

  it('throws when bound executor is offline', async () => {
    const { user, org, executor } = await setupExecutor({ machineName: 'going-offline' });
    const sessionId = await createMcpSession(user.id);

    await bindSession({
      mcpSessionId: sessionId,
      executorId: executor.id,
      userId: user.id,
      organizationId: org.id,
    });

    // Take executor offline
    await updateExecutorStatus(executor.id, user.id, 'offline');

    await expect(
      resolveExecutorForDispatch(sessionId, user.id),
    ).rejects.toThrow(/offline.*cv_disconnect/i);
  });

  it('falls back to any online executor when no binding', async () => {
    const { user } = await setupExecutor({ machineName: 'fallback-machine' });
    const sessionId = await createMcpSession(user.id);

    const result = await resolveExecutorForDispatch(sessionId, user.id);
    expect(result.viaBind).toBe(false);
    expect(result.executor.status).toBe('online');
  });

  it('throws when no online executors available and no binding', async () => {
    const u = uid();
    const user = await createUser({
      email: `${u}@test.com`,
      username: u,
      password: 'pass123',
    });
    const sessionId = await createMcpSession(user.id);

    await expect(
      resolveExecutorForDispatch(sessionId, user.id),
    ).rejects.toThrow(/no online machines/i);
  });
});
