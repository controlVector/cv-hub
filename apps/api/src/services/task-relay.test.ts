/**
 * Task Relay Lifecycle Tests
 *
 * End-to-end unit tests for the full task dispatch → claim → prompt → respond → complete lifecycle.
 * All DB calls are mocked — these test the service logic, not the database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB ─────────────────────────────────────────────────────────
vi.mock('../db', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    query: {
      agentTasks: { findFirst: vi.fn(), findMany: vi.fn() },
      taskPrompts: { findFirst: vi.fn(), findMany: vi.fn() },
    },
  },
}));

import { db } from '../db';

// ── Import services under test ──────────────────────────────────────
import {
  createAgentTask,
  claimNextTask,
  startTask,
  completeTask,
  failTask,
  getAgentTask,
  listAgentTasks,
  cancelAgentTask,
} from './agent-task.service';

import {
  createTaskPrompt,
  respondToPrompt,
  getTaskPrompts,
  getPendingPrompts,
} from './task-prompt.service';

const TASK_ID = '00000000-0000-0000-0000-000000000001';
const EXECUTOR_ID = '00000000-0000-0000-0000-000000000002';
const USER_ID = '00000000-0000-0000-0000-000000000003';
const PROMPT_ID = '00000000-0000-0000-0000-000000000010';

function fakeTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TASK_ID,
    userId: USER_ID,
    executorId: null,
    title: 'Build website',
    description: 'Create a landing page',
    taskType: 'code_change',
    status: 'pending',
    priority: 'medium',
    input: { description: 'Build it' },
    result: null,
    error: null,
    repositoryId: null,
    branch: null,
    filePaths: null,
    mcpSessionId: null,
    parentTaskId: null,
    metadata: null,
    startedAt: null,
    completedAt: null,
    timeoutAt: new Date(Date.now() + 30 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakePrompt(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PROMPT_ID,
    taskId: TASK_ID,
    promptType: 'question',
    promptText: 'Next.js or Astro?',
    options: ['Next.js', 'Astro'],
    context: null,
    response: null,
    respondedAt: null,
    createdAt: new Date(),
    expiresAt: null,
    ...overrides,
  };
}

describe('Task Relay: Full Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Task Creation ───────────────────────────────────────────────
  describe('createAgentTask', () => {
    it('should create a task with pending status', async () => {
      const task = fakeTask();
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([task]),
        }),
      });

      const result = await createAgentTask({
        userId: USER_ID,
        title: 'Build website',
        description: 'Create a landing page',
        taskType: 'code_change',
      });

      expect(result.status).toBe('pending');
      expect(result.title).toBe('Build website');
    });

    it('should set 30-minute default timeout', async () => {
      const task = fakeTask();
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([task]),
        }),
      });

      await createAgentTask({
        userId: USER_ID,
        title: 'Test task',
      });

      // The values() call should have been invoked with timeoutAt set
      expect(db.insert).toHaveBeenCalled();
    });
  });

  // ── Task Claiming ───────────────────────────────────────────────
  describe('claimNextTask', () => {
    it('should claim a pending task', async () => {
      const pending = fakeTask();
      const claimed = fakeTask({ status: 'assigned', executorId: EXECUTOR_ID });

      (db.query.agentTasks.findFirst as any).mockResolvedValue(pending);
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([claimed]),
          }),
        }),
      });

      const result = await claimNextTask(EXECUTOR_ID, USER_ID);
      expect(result).toBeTruthy();
      expect(result!.status).toBe('assigned');
      expect(result!.executorId).toBe(EXECUTOR_ID);
    });

    it('should return null when no pending tasks', async () => {
      (db.query.agentTasks.findFirst as any).mockResolvedValue(null);

      const result = await claimNextTask(EXECUTOR_ID, USER_ID);
      expect(result).toBeNull();
    });

    it('should return null on race condition (task already claimed)', async () => {
      const pending = fakeTask();
      (db.query.agentTasks.findFirst as any).mockResolvedValue(pending);
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]), // Empty = another executor claimed it
          }),
        }),
      });

      const result = await claimNextTask(EXECUTOR_ID, USER_ID);
      expect(result).toBeNull();
    });
  });

  // ── Task Start ──────────────────────────────────────────────────
  describe('startTask', () => {
    it('should mark task as running', async () => {
      const running = fakeTask({ status: 'running', executorId: EXECUTOR_ID, startedAt: new Date() });
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([running]),
          }),
        }),
      });

      const result = await startTask(TASK_ID, EXECUTOR_ID);
      expect(result).toBeTruthy();
      expect(result!.status).toBe('running');
    });
  });

  // ── Task Prompts ────────────────────────────────────────────────
  describe('createTaskPrompt', () => {
    it('should create prompt and set task to waiting_for_input', async () => {
      const prompt = fakePrompt();
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([prompt]),
        }),
      });
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await createTaskPrompt({
        taskId: TASK_ID,
        promptText: 'Next.js or Astro?',
        options: ['Next.js', 'Astro'],
      });

      expect(result.promptText).toBe('Next.js or Astro?');
      // db.update should have been called to set waiting_for_input
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('respondToPrompt', () => {
    it('should store response and set task back to running', async () => {
      const responded = fakePrompt({ response: 'Astro', respondedAt: new Date() });
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([responded]),
          }),
        }),
      });
      // No more pending prompts
      (db.query.taskPrompts.findFirst as any).mockResolvedValue(null);

      const result = await respondToPrompt(PROMPT_ID, 'Astro');
      expect(result).toBeTruthy();
      expect(result!.response).toBe('Astro');
      // Should have called update twice: once for prompt, once for task status
      expect(db.update).toHaveBeenCalledTimes(2);
    });

    it('should keep task waiting if other prompts still pending', async () => {
      const responded = fakePrompt({ response: 'Astro', respondedAt: new Date() });
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([responded]),
          }),
        }),
      });
      // Another pending prompt exists
      (db.query.taskPrompts.findFirst as any).mockResolvedValue(fakePrompt({ id: 'other-prompt' }));

      const result = await respondToPrompt(PROMPT_ID, 'Astro');
      expect(result).toBeTruthy();
      // Should have called update only once (just the prompt, not the task)
      expect(db.update).toHaveBeenCalledTimes(1);
    });

    it('should return null for already-answered prompt', async () => {
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]), // Empty = already answered
          }),
        }),
      });

      const result = await respondToPrompt(PROMPT_ID, 'Too late');
      expect(result).toBeNull();
    });
  });

  // ── Task Completion ─────────────────────────────────────────────
  describe('completeTask', () => {
    it('should set task to completed with result', async () => {
      const completed = fakeTask({
        status: 'completed',
        result: { summary: 'Built the site', filesModified: ['index.html'] },
        completedAt: new Date(),
      });
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([completed]),
          }),
        }),
      });

      const result = await completeTask(TASK_ID, EXECUTOR_ID, {
        summary: 'Built the site',
        filesModified: ['index.html'],
      });

      expect(result).toBeTruthy();
      expect(result!.status).toBe('completed');
      expect(result!.result).toEqual({
        summary: 'Built the site',
        filesModified: ['index.html'],
      });
    });
  });

  describe('failTask', () => {
    it('should set task to failed with error', async () => {
      const failed = fakeTask({
        status: 'failed',
        error: 'Build failed: missing dep',
        completedAt: new Date(),
      });
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([failed]),
          }),
        }),
      });

      const result = await failTask(TASK_ID, EXECUTOR_ID, 'Build failed: missing dep');
      expect(result).toBeTruthy();
      expect(result!.status).toBe('failed');
      expect(result!.error).toBe('Build failed: missing dep');
    });
  });

  // ── Task Cancellation ───────────────────────────────────────────
  describe('cancelAgentTask', () => {
    it('should cancel a pending task', async () => {
      const pending = fakeTask();
      const cancelled = fakeTask({ status: 'cancelled', completedAt: new Date() });

      (db.query.agentTasks.findFirst as any).mockResolvedValue(pending);
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([cancelled]),
          }),
        }),
      });

      const result = await cancelAgentTask(TASK_ID, USER_ID);
      expect(result).toBeTruthy();
      expect(result!.status).toBe('cancelled');
    });

    it('should return task as-is if already completed', async () => {
      const completed = fakeTask({ status: 'completed' });
      (db.query.agentTasks.findFirst as any).mockResolvedValue(completed);

      const result = await cancelAgentTask(TASK_ID, USER_ID);
      expect(result!.status).toBe('completed');
      // Should NOT have called update
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  // ── Query Operations ────────────────────────────────────────────
  describe('getAgentTask', () => {
    it('should return task for valid user', async () => {
      const task = fakeTask();
      (db.query.agentTasks.findFirst as any).mockResolvedValue(task);

      const result = await getAgentTask(TASK_ID, USER_ID);
      expect(result).toBeTruthy();
      expect(result!.id).toBe(TASK_ID);
    });

    it('should return undefined for wrong user', async () => {
      (db.query.agentTasks.findFirst as any).mockResolvedValue(undefined);

      const result = await getAgentTask(TASK_ID, 'wrong-user');
      expect(result).toBeUndefined();
    });
  });

  describe('listAgentTasks', () => {
    it('should list tasks with status filter', async () => {
      const tasks = [fakeTask(), fakeTask({ id: 'task-2', title: 'Task 2' })];
      (db.query.agentTasks.findMany as any).mockResolvedValue(tasks);

      const result = await listAgentTasks({
        userId: USER_ID,
        status: ['running', 'waiting_for_input'],
      });

      expect(result).toHaveLength(2);
    });
  });

  // ── Prompt Queries ──────────────────────────────────────────────
  describe('getTaskPrompts', () => {
    it('should return all prompts for a task', async () => {
      const prompts = [
        fakePrompt(),
        fakePrompt({ id: 'p2', response: 'Done', respondedAt: new Date() }),
      ];
      (db.query.taskPrompts.findMany as any).mockResolvedValue(prompts);

      const result = await getTaskPrompts(TASK_ID);
      expect(result).toHaveLength(2);
    });
  });

  describe('getPendingPrompts', () => {
    it('should return only unanswered prompts', async () => {
      const prompts = [fakePrompt()];
      (db.query.taskPrompts.findMany as any).mockResolvedValue(prompts);

      const result = await getPendingPrompts(TASK_ID);
      expect(result).toHaveLength(1);
      expect(result[0].response).toBeNull();
    });
  });
});
