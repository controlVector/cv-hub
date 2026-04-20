/**
 * Task Events Routes Tests
 * Focused on the v1.3 changes: output/output_final event types, sequence_number,
 * payload size cap.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/agent-task.service', () => ({
  getAgentTask: vi.fn(),
}));

vi.mock('../services/task-events.service', () => ({
  createTaskEvent: vi.fn(),
  getTaskEvents: vi.fn(),
  respondToTaskEvent: vi.fn(),
  createRedirectEvent: vi.fn(),
  getTaskEventSummary: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireAuth: async (c: any, next: () => Promise<void>) => {
    c.set('userId', 'test-user-id');
    return next();
  },
}));

import { taskEventRoutes } from './task-events';
import { getAgentTask } from '../services/agent-task.service';
import { createTaskEvent } from '../services/task-events.service';

const mockGetAgentTask = vi.mocked(getAgentTask);
const mockCreateTaskEvent = vi.mocked(createTaskEvent);

const TASK_ID = '00000000-0000-0000-0000-000000000001';

function fakeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    userId: 'test-user-id',
    title: 'A task',
    status: 'running',
    ...overrides,
  } as any;
}

function fakeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000010',
    taskId: TASK_ID,
    eventType: 'output',
    content: {},
    needsResponse: false,
    response: null,
    respondedAt: null,
    sequenceNumber: null,
    createdAt: new Date(),
    ...overrides,
  } as any;
}

describe('POST /:taskId/events — output event types (regression for v1.2.0 silent drop)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts event_type=output with chunk content', async () => {
    mockGetAgentTask.mockResolvedValue(fakeTask());
    mockCreateTaskEvent.mockResolvedValue(fakeEvent({ eventType: 'output' }));

    const res = await taskEventRoutes.request(`/${TASK_ID}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'output',
        content: { chunk: 'Claude Code says hello', byte_offset: 22 },
      }),
    });

    expect(res.status).toBe(201);
    expect(mockCreateTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: TASK_ID,
        eventType: 'output',
      }),
    );
  });

  it('accepts event_type=output_final with full output payload', async () => {
    mockGetAgentTask.mockResolvedValue(fakeTask());
    mockCreateTaskEvent.mockResolvedValue(fakeEvent({ eventType: 'output_final' }));

    const res = await taskEventRoutes.request(`/${TASK_ID}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'output_final',
        content: { output: 'final text', exit_code: 0, duration_seconds: 12 },
      }),
    });

    expect(res.status).toBe(201);
  });

  it('persists sequence_number when provided', async () => {
    mockGetAgentTask.mockResolvedValue(fakeTask());
    mockCreateTaskEvent.mockResolvedValue(fakeEvent({ sequenceNumber: 42 }));

    const res = await taskEventRoutes.request(`/${TASK_ID}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'output',
        content: { chunk: 'x' },
        sequence_number: 42,
      }),
    });

    expect(res.status).toBe(201);
    expect(mockCreateTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sequenceNumber: 42 }),
    );
  });

  it('rejects content larger than 64KB with 413', async () => {
    mockGetAgentTask.mockResolvedValue(fakeTask());

    const bigChunk = 'x'.repeat(65 * 1024);
    const res = await taskEventRoutes.request(`/${TASK_ID}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'output',
        content: { chunk: bigChunk },
      }),
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toMatch(/64KB/);
    expect(mockCreateTaskEvent).not.toHaveBeenCalled();
  });

  it('rejects unknown event_type', async () => {
    const res = await taskEventRoutes.request(`/${TASK_ID}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'garbage',
        content: {},
      }),
    });

    expect(res.status).toBe(400);
  });

  it('still accepts legacy event types', async () => {
    mockGetAgentTask.mockResolvedValue(fakeTask());
    mockCreateTaskEvent.mockResolvedValue(fakeEvent({ eventType: 'thinking' }));

    const res = await taskEventRoutes.request(`/${TASK_ID}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'thinking',
        content: 'pondering',
      }),
    });

    expect(res.status).toBe(201);
  });
});
