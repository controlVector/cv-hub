/**
 * Chat-to-Code Bridge E2E Tests (Sprint 9 — Step 8)
 *
 * 8a. Full bridge lifecycle — register, connect, dispatch, claim, complete, disconnect
 * 8b. Offline executor — binding + offline detection + reconnect
 * 8c. Multi-user isolation — users only see their own executors
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createUser } from './user.service';
import { createOrganization } from './organization.service';
import {
  registerExecutor,
  listExecutors,
  listExecutorsFiltered,
  findExecutorByMachineName,
  heartbeat,
  updateExecutorStatus,
  unregisterExecutor,
} from './executor.service';
import {
  createAgentTask,
  listAgentTasks,
  claimNextTask,
  startTask,
  completeTask,
  getAgentTask,
} from './agent-task.service';
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
function uid() { return `e2e_${Date.now()}_${++seq}`; }

async function setupUserAndOrg() {
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
    name: `claude-code:${machineName}:${uid().slice(-4)}`,
    machineName,
    type: 'claude_code',
    repos: repos || ['test-repo'],
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
// 8a. Full Bridge Lifecycle
// ---------------------------------------------------------------------------

describe('Full Bridge Lifecycle', () => {
  let userId: string;
  let orgId: string;
  let executorId: string;
  let mcpSessionId: string;

  beforeEach(async () => {
    const { user, org } = await setupUserAndOrg();
    userId = user.id;
    orgId = org.id;
    const executor = await setupExecutor(userId, orgId, 'test-machine', ['test-repo']);
    executorId = executor.id;
    mcpSessionId = await createMcpSession(userId);
  });

  it('Step 1-2: registers executor and sends heartbeats', async () => {
    const executors = await listExecutors(userId);
    expect(executors.length).toBe(1);
    expect(executors[0].status).toBe('online');
    expect(executors[0].machineName).toBe('test-machine');

    // Heartbeat keeps it online
    const updated = await heartbeat(executorId, userId);
    expect(updated!.status).toBe('online');
  });

  it('Step 3: MCP session created for Claude.ai', async () => {
    expect(mcpSessionId).toBeTruthy();
  });

  it('Step 4: cv_list_executors shows online machine', async () => {
    const list = await listExecutorsFiltered(userId, { status: 'online' });
    expect(list.length).toBe(1);
    expect(list[0].machineName).toBe('test-machine');
    expect(list[0].repos).toEqual(['test-repo']);
  });

  it('Step 5: cv_connect binds session to machine', async () => {
    const executor = await findExecutorByMachineName(userId, 'test-machine');
    expect(executor).not.toBeNull();

    const binding = await bindSession({
      mcpSessionId,
      executorId: executor!.id,
      userId,
      organizationId: orgId,
    });
    expect(binding.executorId).toBe(executorId);
  });

  it('Step 6: cv_connection_status shows test-machine', async () => {
    await bindSession({
      mcpSessionId,
      executorId,
      userId,
      organizationId: orgId,
    });

    const binding = await getActiveBinding(mcpSessionId);
    expect(binding).not.toBeNull();
    expect(binding!.executor.machineName).toBe('test-machine');
  });

  it('Step 7-8: dispatch task → routed to bound executor → claimed', async () => {
    await bindSession({
      mcpSessionId,
      executorId,
      userId,
      organizationId: orgId,
    });

    // Dispatch
    const resolution = await resolveExecutorForDispatch(mcpSessionId, userId);
    expect(resolution.viaBind).toBe(true);
    expect(resolution.executor.id).toBe(executorId);

    // Create task
    const task = await createAgentTask({
      userId,
      title: 'E2E test task',
      description: 'Test task for bridge E2E',
      taskType: 'debug',
      priority: 'high',
      mcpSessionId,
    });
    expect(task.status).toBe('pending');

    // Claim as executor
    const claimed = await claimNextTask(executorId, userId);
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(task.id);
    expect(claimed!.status).toBe('assigned');
  });

  it('Step 9: complete task → status completed', async () => {
    const task = await createAgentTask({
      userId,
      title: 'Complete me',
      taskType: 'debug',
      priority: 'high',
    });

    const claimed = await claimNextTask(executorId, userId);
    expect(claimed).not.toBeNull();

    const started = await startTask(claimed!.id, executorId);
    expect(started!.status).toBe('running');

    const completed = await completeTask(claimed!.id, executorId, {
      summary: 'Fixed the bug',
      filesModified: ['src/app.ts'],
    });
    expect(completed!.status).toBe('completed');
    expect(completed!.result).toEqual({
      summary: 'Fixed the bug',
      filesModified: ['src/app.ts'],
    });
  });

  it('Step 10: get task result after completion', async () => {
    const task = await createAgentTask({
      userId,
      title: 'Result check',
      taskType: 'debug',
      priority: 'medium',
    });

    await claimNextTask(executorId, userId);
    await startTask(task.id, executorId);
    await completeTask(task.id, executorId, { summary: 'Done' });

    const result = await getAgentTask(task.id, userId);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('completed');
    expect(result!.result).toEqual({ summary: 'Done' });
  });

  it('Step 11-12: cv_disconnect unbinds → status shows not connected', async () => {
    await bindSession({
      mcpSessionId,
      executorId,
      userId,
      organizationId: orgId,
    });

    await unbindSession(mcpSessionId, userId);

    const binding = await getActiveBinding(mcpSessionId);
    expect(binding).toBeNull();
  });

  it('Step 13: dispatch after disconnect falls back to any executor', async () => {
    // No binding — should fall back
    const resolution = await resolveExecutorForDispatch(mcpSessionId, userId);
    expect(resolution.viaBind).toBe(false);
    expect(resolution.executor.status).toBe('online');
  });
});

// ---------------------------------------------------------------------------
// 8b. Offline Executor Handling
// ---------------------------------------------------------------------------

describe('Offline Executor Handling', () => {
  let userId: string;
  let orgId: string;
  let executorId: string;
  let mcpSessionId: string;

  beforeEach(async () => {
    const { user, org } = await setupUserAndOrg();
    userId = user.id;
    orgId = org.id;
    const executor = await setupExecutor(userId, orgId, 'offline-machine');
    executorId = executor.id;
    mcpSessionId = await createMcpSession(userId);
  });

  it('dispatch fails when bound executor goes offline', async () => {
    await bindSession({
      mcpSessionId,
      executorId,
      userId,
      organizationId: orgId,
    });

    // Take offline
    await updateExecutorStatus(executorId, userId, 'offline');

    await expect(
      resolveExecutorForDispatch(mcpSessionId, userId),
    ).rejects.toThrow(/offline/i);
  });

  it('cv_list_executors shows offline status', async () => {
    await updateExecutorStatus(executorId, userId, 'offline');

    const all = await listExecutorsFiltered(userId, { status: 'all' });
    expect(all.find((e) => e.id === executorId)!.status).toBe('offline');

    const online = await listExecutorsFiltered(userId, { status: 'online' });
    expect(online.find((e) => e.id === executorId)).toBeUndefined();
  });

  it('must disconnect before connecting to different machine', async () => {
    await bindSession({
      mcpSessionId,
      executorId,
      userId,
      organizationId: orgId,
    });

    // Try to bind again without disconnecting
    const exec2 = await setupExecutor(userId, orgId, 'other-machine');
    await expect(
      bindSession({
        mcpSessionId,
        executorId: exec2.id,
        userId,
        organizationId: orgId,
      }),
    ).rejects.toThrow(/already connected/i);
  });

  it('disconnect then reconnect to new machine works', async () => {
    await bindSession({
      mcpSessionId,
      executorId,
      userId,
      organizationId: orgId,
    });

    // Disconnect
    await unbindSession(mcpSessionId, userId);

    // Connect to new machine
    const exec2 = await setupExecutor(userId, orgId, 'backup-machine');
    const binding = await bindSession({
      mcpSessionId,
      executorId: exec2.id,
      userId,
      organizationId: orgId,
    });
    expect(binding.executorId).toBe(exec2.id);
  });
});

// ---------------------------------------------------------------------------
// 8c. Multi-User Isolation
// ---------------------------------------------------------------------------

describe('Multi-User Isolation', () => {
  let userA: { id: string };
  let userB: { id: string };
  let orgA: { id: string };
  let orgB: { id: string };
  let executorA: string;
  let executorB: string;

  beforeEach(async () => {
    const setupA = await setupUserAndOrg();
    const setupB = await setupUserAndOrg();
    userA = setupA.user;
    userB = setupB.user;
    orgA = setupA.org;
    orgB = setupB.org;

    const exA = await setupExecutor(userA.id, orgA.id, 'user-a-machine');
    const exB = await setupExecutor(userB.id, orgB.id, 'user-b-machine');
    executorA = exA.id;
    executorB = exB.id;
  });

  it('User A only sees own executors', async () => {
    const list = await listExecutorsFiltered(userA.id, { status: 'all' });
    expect(list.length).toBe(1);
    expect(list[0].machineName).toBe('user-a-machine');
  });

  it('User B only sees own executors', async () => {
    const list = await listExecutorsFiltered(userB.id, { status: 'all' });
    expect(list.length).toBe(1);
    expect(list[0].machineName).toBe('user-b-machine');
  });

  it('User A cannot bind to User B executor', async () => {
    const sessionA = await createMcpSession(userA.id);

    await expect(
      bindSession({
        mcpSessionId: sessionA,
        executorId: executorB,
        userId: userA.id,
        organizationId: orgA.id,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('User A dispatches to own executor, User B to own', async () => {
    const sessionA = await createMcpSession(userA.id);
    const sessionB = await createMcpSession(userB.id);

    await bindSession({
      mcpSessionId: sessionA,
      executorId: executorA,
      userId: userA.id,
      organizationId: orgA.id,
    });

    await bindSession({
      mcpSessionId: sessionB,
      executorId: executorB,
      userId: userB.id,
      organizationId: orgB.id,
    });

    const resA = await resolveExecutorForDispatch(sessionA, userA.id);
    const resB = await resolveExecutorForDispatch(sessionB, userB.id);

    expect(resA.executor.id).toBe(executorA);
    expect(resB.executor.id).toBe(executorB);
    expect(resA.executor.id).not.toBe(resB.executor.id);
  });

  it('findExecutorByMachineName is user-scoped', async () => {
    const foundByA = await findExecutorByMachineName(userA.id, 'user-b-machine');
    expect(foundByA).toBeNull();

    const foundByB = await findExecutorByMachineName(userB.id, 'user-a-machine');
    expect(foundByB).toBeNull();
  });

  it('User A cannot claim User B tasks', async () => {
    const taskB = await createAgentTask({
      userId: userB.id,
      title: 'User B task',
      taskType: 'debug',
      priority: 'high',
    });

    // User A's executor tries to claim — should get null (no tasks for this user)
    const claimed = await claimNextTask(executorA, userA.id);
    expect(claimed).toBeNull();
  });
});
