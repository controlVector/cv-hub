/**
 * Multi-Tenant Isolation Tests: Executors and Tasks
 *
 * Verifies that User A cannot see, dispatch to, or interact with
 * User B's executors or tasks. Every operation must be scoped to
 * the authenticated user.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createUser } from './user.service';
import {
  registerExecutor,
  listExecutors,
  getExecutor,
} from './executor.service';
import {
  createAgentTask,
  listAgentTasks,
  getAgentTask,
  claimNextTask,
} from './agent-task.service';

let seq = 0;
function uid() { return `iso_${Date.now()}_${++seq}`; }

describe('Executor & Task Multi-Tenant Isolation', () => {
  let userA: { id: string };
  let userB: { id: string };

  beforeEach(async () => {
    const u = uid();
    userA = await createUser({ email: `a_${u}@test.com`, username: `a_${u}`, password: 'pass123' });
    userB = await createUser({ email: `b_${u}@test.com`, username: `b_${u}`, password: 'pass123' });
  });

  // ── Executor isolation ──────────────────────────────────────────

  it('User B cannot see User A executors via listExecutors', async () => {
    const u = uid();
    await registerExecutor({
      userId: userA.id,
      name: `exec-a-${u}`,
      machineName: `machine-a-${u}`,
      type: 'claude_code',
    });

    const bExecutors = await listExecutors(userB.id);
    const names = bExecutors.map((e) => e.name);
    expect(names).not.toContain(`exec-a-${u}`);
  });

  it('User B cannot get User A executor by ID', async () => {
    const u = uid();
    const execA = await registerExecutor({
      userId: userA.id,
      name: `exec-a-${u}`,
      machineName: `machine-a-${u}`,
      type: 'claude_code',
    });

    const result = await getExecutor(execA.id, userB.id);
    expect(result).toBeFalsy();
  });

  // ── Task isolation ──────────────────────────────────────────────

  it('User B cannot see User A tasks via listAgentTasks', async () => {
    const u = uid();
    await createAgentTask({
      userId: userA.id,
      title: `task-a-${u}`,
      taskType: 'code_change',
      priority: 'high',
    });

    const bTasks = await listAgentTasks(userB.id);
    const titles = bTasks.map((t) => t.title);
    expect(titles).not.toContain(`task-a-${u}`);
  });

  it('User B cannot get User A task by ID', async () => {
    const u = uid();
    const taskA = await createAgentTask({
      userId: userA.id,
      title: `task-a-${u}`,
      taskType: 'code_change',
      priority: 'high',
    });

    const result = await getAgentTask(taskA.id, userB.id);
    expect(result).toBeUndefined();
  });

  it('User B executor cannot claim User A tasks', async () => {
    const u = uid();
    // User A creates a task
    await createAgentTask({
      userId: userA.id,
      title: `task-a-${u}`,
      taskType: 'code_change',
      priority: 'high',
    });

    // User B registers an executor and tries to claim
    const execB = await registerExecutor({
      userId: userB.id,
      name: `exec-b-${u}`,
      machineName: `machine-b-${u}`,
      type: 'claude_code',
    });

    const claimed = await claimNextTask(execB.id, userB.id);
    expect(claimed).toBeNull();
  });

  it('User A executor can claim User A tasks', async () => {
    const u = uid();
    await createAgentTask({
      userId: userA.id,
      title: `task-a-${u}`,
      taskType: 'code_change',
      priority: 'high',
    });

    const execA = await registerExecutor({
      userId: userA.id,
      name: `exec-a-${u}`,
      machineName: `machine-a-${u}`,
      type: 'claude_code',
    });

    const claimed = await claimNextTask(execA.id, userA.id);
    expect(claimed).not.toBeNull();
    expect(claimed!.title).toBe(`task-a-${u}`);
  });

  // ── Cross-user defense-in-depth ──────────────────────────────────

  it('listExecutors returns only own executors', async () => {
    const u = uid();
    await registerExecutor({
      userId: userA.id,
      name: `exec-a-${u}`,
      machineName: `machine-a-${u}`,
      type: 'claude_code',
    });
    await registerExecutor({
      userId: userB.id,
      name: `exec-b-${u}`,
      machineName: `machine-b-${u}`,
      type: 'claude_code',
    });

    const aExecs = await listExecutors(userA.id);
    const bExecs = await listExecutors(userB.id);

    expect(aExecs.every((e) => e.userId === userA.id)).toBe(true);
    expect(bExecs.every((e) => e.userId === userB.id)).toBe(true);
    expect(aExecs.some((e) => e.name === `exec-b-${u}`)).toBe(false);
    expect(bExecs.some((e) => e.name === `exec-a-${u}`)).toBe(false);
  });

  it('listAgentTasks returns only own tasks', async () => {
    const u = uid();
    await createAgentTask({
      userId: userA.id,
      title: `task-a-${u}`,
    });
    await createAgentTask({
      userId: userB.id,
      title: `task-b-${u}`,
    });

    const aTasks = await listAgentTasks(userA.id);
    const bTasks = await listAgentTasks(userB.id);

    expect(aTasks.every((t) => t.userId === userA.id)).toBe(true);
    expect(bTasks.every((t) => t.userId === userB.id)).toBe(true);
    expect(aTasks.some((t) => t.title === `task-b-${u}`)).toBe(false);
    expect(bTasks.some((t) => t.title === `task-a-${u}`)).toBe(false);
  });
});
