/**
 * MCP Bridge Tools Tests (Sprint 9 — Step 3)
 *
 * Tests for cv_list_executors, cv_connect, cv_disconnect, cv_connection_status
 * and dispatch routing with bindings.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createUser } from './user.service';
import { createOrganization } from './organization.service';
import {
  registerExecutor,
  updateExecutorStatus,
  findExecutorByMachineName,
  listExecutorsFiltered,
} from './executor.service';
import {
  bindSession,
  unbindSession,
  getActiveBinding,
  resolveExecutorForDispatch,
} from './session-binding.service';
import { db } from '../db';
import { mcpSessions } from '../db/schema';
import { generateSecureToken } from '../utils/crypto';

let seq = 0;
function uid() { return `bt_${Date.now()}_${++seq}`; }

async function setupUser() {
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
  return { user, org };
}

async function setupExecutor(
  userId: string,
  orgId: string,
  machineName: string,
  repos?: string[],
) {
  const { executor } = await registerExecutor({
    userId,
    name: `claude-code:${machineName}:abc`,
    machineName,
    type: 'claude_code',
    repos: repos || ['cv-hub'],
    organizationId: orgId,
  });
  return executor;
}

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
// cv_list_executors behavior
// ---------------------------------------------------------------------------

describe('cv_list_executors', () => {
  it('returns all executors for user', async () => {
    const { user, org } = await setupUser();
    await setupExecutor(user.id, org.id, 'machine-a', ['cv-hub']);
    await setupExecutor(user.id, org.id, 'machine-b', ['cv-git']);

    const all = await listExecutorsFiltered(user.id, { status: 'all' });
    expect(all.length).toBe(2);
  });

  it('returns only online executors when filtered', async () => {
    const { user, org } = await setupUser();
    const a = await setupExecutor(user.id, org.id, 'online-box');
    const b = await setupExecutor(user.id, org.id, 'offline-box');
    await updateExecutorStatus(b.id, user.id, 'offline');

    const online = await listExecutorsFiltered(user.id, { status: 'online' });
    expect(online.length).toBe(1);
    expect(online[0].machineName).toBe('online-box');
  });

  it('returns empty list for user with no executors', async () => {
    const { user } = await setupUser();
    const result = await listExecutorsFiltered(user.id, { status: 'all' });
    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// cv_connect behavior
// ---------------------------------------------------------------------------

describe('cv_connect', () => {
  it('finds executor by machine name (case-insensitive)', async () => {
    const { user, org } = await setupUser();
    await setupExecutor(user.id, org.id, 'Z840-Primary');

    const found = await findExecutorByMachineName(user.id, 'z840-primary');
    expect(found).not.toBeNull();
    expect(found!.machineName).toBe('Z840-Primary');
  });

  it('creates binding on connect', async () => {
    const { user, org } = await setupUser();
    const exec = await setupExecutor(user.id, org.id, 'connect-test');
    const sessionId = await createMcpSession(user.id);

    const binding = await bindSession({
      mcpSessionId: sessionId,
      executorId: exec.id,
      userId: user.id,
      organizationId: org.id,
    });

    expect(binding.executorId).toBe(exec.id);
    expect(binding.mcpSessionId).toBe(sessionId);
  });

  it('rejects connect to offline machine', async () => {
    const { user, org } = await setupUser();
    const exec = await setupExecutor(user.id, org.id, 'offline-connect');
    await updateExecutorStatus(exec.id, user.id, 'offline');
    const sessionId = await createMcpSession(user.id);

    await expect(
      bindSession({
        mcpSessionId: sessionId,
        executorId: exec.id,
        userId: user.id,
        organizationId: org.id,
      }),
    ).rejects.toThrow(/offline/i);
  });

  it('rejects connect to nonexistent machine name', async () => {
    const { user } = await setupUser();
    const found = await findExecutorByMachineName(user.id, 'does-not-exist');
    expect(found).toBeNull();
  });

  it('rejects connect when already connected', async () => {
    const { user, org } = await setupUser();
    const exec = await setupExecutor(user.id, org.id, 'double-connect');
    const sessionId = await createMcpSession(user.id);

    await bindSession({
      mcpSessionId: sessionId,
      executorId: exec.id,
      userId: user.id,
      organizationId: org.id,
    });

    // Try to connect again
    await expect(
      bindSession({
        mcpSessionId: sessionId,
        executorId: exec.id,
        userId: user.id,
        organizationId: org.id,
      }),
    ).rejects.toThrow(/already connected/i);
  });
});

// ---------------------------------------------------------------------------
// cv_disconnect behavior
// ---------------------------------------------------------------------------

describe('cv_disconnect', () => {
  it('unbinds active binding', async () => {
    const { user, org } = await setupUser();
    const exec = await setupExecutor(user.id, org.id, 'disconnect-test');
    const sessionId = await createMcpSession(user.id);

    await bindSession({
      mcpSessionId: sessionId,
      executorId: exec.id,
      userId: user.id,
      organizationId: org.id,
    });

    const result = await unbindSession(sessionId, user.id);
    expect(result).not.toBeNull();
    expect(result!.unboundAt).toBeInstanceOf(Date);
  });

  it('returns null when not connected', async () => {
    const { user } = await setupUser();
    const sessionId = await createMcpSession(user.id);
    const result = await unbindSession(sessionId, user.id);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cv_connection_status behavior
// ---------------------------------------------------------------------------

describe('cv_connection_status', () => {
  it('returns binding details when connected', async () => {
    const { user, org } = await setupUser();
    const exec = await setupExecutor(user.id, org.id, 'status-test', ['cv-hub', 'nyx']);
    const sessionId = await createMcpSession(user.id);

    await bindSession({
      mcpSessionId: sessionId,
      executorId: exec.id,
      userId: user.id,
      organizationId: org.id,
    });

    const binding = await getActiveBinding(sessionId);
    expect(binding).not.toBeNull();
    expect(binding!.executor.machineName).toBe('status-test');
    expect(binding!.executor.repos).toEqual(['cv-hub', 'nyx']);
  });

  it('returns null when not connected', async () => {
    const { user } = await setupUser();
    const sessionId = await createMcpSession(user.id);
    const binding = await getActiveBinding(sessionId);
    expect(binding).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dispatch routing with bindings
// ---------------------------------------------------------------------------

describe('Dispatch with bindings', () => {
  it('routes to bound executor when binding exists', async () => {
    const { user, org } = await setupUser();
    const exec = await setupExecutor(user.id, org.id, 'dispatch-bound');
    const sessionId = await createMcpSession(user.id);

    await bindSession({
      mcpSessionId: sessionId,
      executorId: exec.id,
      userId: user.id,
      organizationId: org.id,
    });

    const result = await resolveExecutorForDispatch(sessionId, user.id);
    expect(result.viaBind).toBe(true);
    expect(result.executor.id).toBe(exec.id);
  });

  it('errors when bound executor goes offline', async () => {
    const { user, org } = await setupUser();
    const exec = await setupExecutor(user.id, org.id, 'dispatch-offline');
    const sessionId = await createMcpSession(user.id);

    await bindSession({
      mcpSessionId: sessionId,
      executorId: exec.id,
      userId: user.id,
      organizationId: org.id,
    });
    await updateExecutorStatus(exec.id, user.id, 'offline');

    await expect(
      resolveExecutorForDispatch(sessionId, user.id),
    ).rejects.toThrow(/offline/i);
  });

  it('falls back to any online executor when not bound', async () => {
    const { user, org } = await setupUser();
    await setupExecutor(user.id, org.id, 'fallback-exec');
    const sessionId = await createMcpSession(user.id);

    const result = await resolveExecutorForDispatch(sessionId, user.id);
    expect(result.viaBind).toBe(false);
    expect(result.executor.machineName).toBe('fallback-exec');
  });
});
