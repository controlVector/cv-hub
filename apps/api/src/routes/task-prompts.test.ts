/**
 * Task Prompt Routes Tests
 * Tests for bidirectional executor ↔ user communication via prompts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock services ───────────────────────────────────────────────────
vi.mock('../services/agent-task.service', () => ({
  getAgentTask: vi.fn(),
}));

vi.mock('../services/task-prompt.service', () => ({
  createTaskPrompt: vi.fn(),
  respondToPrompt: vi.fn(),
  getTaskPrompts: vi.fn(),
  getPendingPrompts: vi.fn(),
  getPrompt: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireAuth: async (c: any, next: () => Promise<void>) => {
    c.set('userId', 'test-user-id');
    c.set('tokenScopes', ['repo:read', 'repo:write']);
    return next();
  },
}));

import { taskPromptRoutes } from './task-prompts';
import { getAgentTask } from '../services/agent-task.service';
import {
  createTaskPrompt,
  respondToPrompt,
  getTaskPrompts,
  getPendingPrompts,
  getPrompt,
} from '../services/task-prompt.service';

const mockGetAgentTask = vi.mocked(getAgentTask);
const mockCreateTaskPrompt = vi.mocked(createTaskPrompt);
const mockRespondToPrompt = vi.mocked(respondToPrompt);
const mockGetTaskPrompts = vi.mocked(getTaskPrompts);
const mockGetPendingPrompts = vi.mocked(getPendingPrompts);
const mockGetPrompt = vi.mocked(getPrompt);

const TASK_ID = '00000000-0000-0000-0000-000000000001';
const PROMPT_ID = '00000000-0000-0000-0000-000000000010';

function fakeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    userId: 'test-user-id',
    title: 'Build website',
    status: 'running',
    ...overrides,
  } as any;
}

function fakePrompt(overrides: Record<string, unknown> = {}) {
  return {
    id: PROMPT_ID,
    taskId: TASK_ID,
    promptType: 'question',
    promptText: 'Use Next.js or Astro?',
    options: ['Next.js', 'Astro'],
    context: null,
    response: null,
    respondedAt: null,
    createdAt: new Date(),
    expiresAt: null,
    ...overrides,
  } as any;
}

describe('POST /:taskId/prompts (create prompt)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should create a prompt for a running task', async () => {
    mockGetAgentTask.mockResolvedValue(fakeTask());
    mockCreateTaskPrompt.mockResolvedValue(fakePrompt());

    const res = await taskPromptRoutes.request(`/${TASK_ID}/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt_text: 'Use Next.js or Astro?',
        prompt_type: 'choice',
        options: ['Next.js', 'Astro'],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(PROMPT_ID);
    expect(body.prompt_text).toBe('Use Next.js or Astro?');
    expect(mockCreateTaskPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: TASK_ID,
        promptType: 'choice',
        promptText: 'Use Next.js or Astro?',
      }),
    );
  });

  it('should create a prompt for an assigned task', async () => {
    mockGetAgentTask.mockResolvedValue(fakeTask({ status: 'assigned' }));
    mockCreateTaskPrompt.mockResolvedValue(fakePrompt());

    const res = await taskPromptRoutes.request(`/${TASK_ID}/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt_text: 'Confirm setup?' }),
    });

    expect(res.status).toBe(201);
  });

  it('should reject prompt for completed task', async () => {
    mockGetAgentTask.mockResolvedValue(fakeTask({ status: 'completed' }));

    const res = await taskPromptRoutes.request(`/${TASK_ID}/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt_text: 'Too late?' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Cannot create prompt/);
  });

  it('should return 404 for unknown task', async () => {
    mockGetAgentTask.mockResolvedValue(undefined);

    const res = await taskPromptRoutes.request(`/${TASK_ID}/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt_text: 'Hello?' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('GET /:taskId/prompts (list prompts)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should list all prompts for a task', async () => {
    mockGetAgentTask.mockResolvedValue(fakeTask());
    mockGetTaskPrompts.mockResolvedValue([
      fakePrompt(),
      fakePrompt({ id: 'p2', response: 'Astro', respondedAt: new Date() }),
    ]);

    const res = await taskPromptRoutes.request(`/${TASK_ID}/prompts`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompts).toHaveLength(2);
  });

  it('should return 404 for unknown task', async () => {
    mockGetAgentTask.mockResolvedValue(undefined);

    const res = await taskPromptRoutes.request(`/${TASK_ID}/prompts`);
    expect(res.status).toBe(404);
  });
});

describe('GET /:taskId/prompts/pending (pending prompts)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should return only unanswered prompts', async () => {
    mockGetAgentTask.mockResolvedValue(fakeTask());
    mockGetPendingPrompts.mockResolvedValue([fakePrompt()]);

    const res = await taskPromptRoutes.request(`/${TASK_ID}/prompts/pending`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompts).toHaveLength(1);
    expect(body.prompts[0].response).toBeUndefined(); // Not included in pending response
  });

  it('should return empty when all prompts answered', async () => {
    mockGetAgentTask.mockResolvedValue(fakeTask());
    mockGetPendingPrompts.mockResolvedValue([]);

    const res = await taskPromptRoutes.request(`/${TASK_ID}/prompts/pending`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompts).toHaveLength(0);
  });
});

describe('POST /:taskId/prompts/:promptId/respond', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should respond to a pending prompt', async () => {
    mockGetAgentTask.mockResolvedValue(fakeTask());
    mockGetPrompt.mockResolvedValue(fakePrompt());
    mockRespondToPrompt.mockResolvedValue(
      fakePrompt({ response: 'Astro', respondedAt: new Date() }),
    );

    const res = await taskPromptRoutes.request(
      `/${TASK_ID}/prompts/${PROMPT_ID}/respond`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: 'Astro' }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response).toBe('Astro');
    expect(body.responded_at).toBeDefined();
  });

  it('should reject double-response (409)', async () => {
    mockGetAgentTask.mockResolvedValue(fakeTask());
    mockGetPrompt.mockResolvedValue(
      fakePrompt({ response: 'Already answered', respondedAt: new Date() }),
    );

    const res = await taskPromptRoutes.request(
      `/${TASK_ID}/prompts/${PROMPT_ID}/respond`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: 'Try again' }),
      },
    );

    expect(res.status).toBe(409);
  });

  it('should return 404 for wrong task', async () => {
    mockGetAgentTask.mockResolvedValue(fakeTask());
    mockGetPrompt.mockResolvedValue(
      fakePrompt({ taskId: 'different-task-id' }),
    );

    const res = await taskPromptRoutes.request(
      `/${TASK_ID}/prompts/${PROMPT_ID}/respond`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: 'Astro' }),
      },
    );

    expect(res.status).toBe(404);
  });

  it('should return 404 for unknown task', async () => {
    mockGetAgentTask.mockResolvedValue(undefined);

    const res = await taskPromptRoutes.request(
      `/${TASK_ID}/prompts/${PROMPT_ID}/respond`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: 'Astro' }),
      },
    );

    expect(res.status).toBe(404);
  });
});
