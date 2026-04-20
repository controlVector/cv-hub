/**
 * Task Events API Routes
 * Real-time bidirectional thinking stream between executor and planner.
 *
 * Mounted at /api/v1/tasks (alongside existing task routes).
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth';
import {
  createTaskEvent,
  getTaskEvents,
  respondToTaskEvent,
  createRedirectEvent,
  getTaskEventSummary,
} from '../services/task-events.service';
import { getAgentTask } from '../services/agent-task.service';
import type { AppEnv } from '../app';

const taskEventRoutes = new Hono<AppEnv>();

// All routes require auth
taskEventRoutes.use('*', requireAuth);

function getUserId(c: any): string {
  const userId = c.get('userId');
  if (!userId) throw new Error('Not authenticated');
  return userId;
}

// ── POST /:taskId/events ──────────────────────────────────────────────
// Create an event (called by executor via cv-agent)

const createEventSchema = z.object({
  event_type: z.enum([
    'thinking', 'decision', 'question', 'progress',
    'file_change', 'error', 'approval_request', 'completed',
    'redirect', 'output', 'output_final',
  ]),
  content: z.union([z.record(z.unknown()), z.string()]),
  needs_response: z.boolean().optional(),
  sequence_number: z.number().int().nonnegative().optional(),
});

const MAX_EVENT_CONTENT_BYTES = 64 * 1024;

taskEventRoutes.post(
  '/:taskId/events',
  zValidator('json', createEventSchema),
  async (c) => {
    const userId = getUserId(c);
    const { taskId } = c.req.param();
    const body = c.req.valid('json');

    const task = await getAgentTask(taskId, userId);
    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }

    const contentBytes = Buffer.byteLength(
      typeof body.content === 'string' ? body.content : JSON.stringify(body.content),
      'utf8',
    );
    if (contentBytes > MAX_EVENT_CONTENT_BYTES) {
      return c.json({
        error: 'Event content exceeds 64KB limit — chunk output across multiple events',
        size_bytes: contentBytes,
        limit_bytes: MAX_EVENT_CONTENT_BYTES,
      }, 413);
    }

    const event = await createTaskEvent({
      taskId,
      eventType: body.event_type,
      content: body.content,
      needsResponse: body.needs_response,
      sequenceNumber: body.sequence_number,
    });

    return c.json(event, 201);
  },
);

// ── GET /:taskId/events ───────────────────────────────────────────────
// List events (for polling)

taskEventRoutes.get('/:taskId/events', async (c) => {
  const userId = getUserId(c);
  const { taskId } = c.req.param();
  const afterId = c.req.query('after_id');
  const afterTimestamp = c.req.query('after_timestamp');
  const limit = parseInt(c.req.query('limit') || '50', 10);

  const task = await getAgentTask(taskId, userId);
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const events = await getTaskEvents({
    taskId,
    afterId: afterId ?? undefined,
    afterTimestamp: afterTimestamp ?? undefined,
    limit,
  });

  return c.json(events);
});

// ── GET /:taskId/events/stream ────────────────────────────────────────
// SSE stream of events (for real-time)

taskEventRoutes.get('/:taskId/events/stream', async (c) => {
  const userId = getUserId(c);
  const { taskId } = c.req.param();

  const task = await getAgentTask(taskId, userId);
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  return streamSSE(c, async (stream) => {
    // Backfill existing events
    const existing = await getTaskEvents({ taskId });
    for (const event of existing) {
      await stream.writeSSE({
        event: 'task_event',
        data: JSON.stringify(event),
        id: event.id,
      });
    }

    let lastEventId = existing[existing.length - 1]?.id;
    let stopped = false;

    // Poll for new events every 2 seconds
    const interval = setInterval(async () => {
      if (stopped) return;
      try {
        const newEvents = await getTaskEvents({
          taskId,
          afterId: lastEventId,
        });

        for (const event of newEvents) {
          await stream.writeSSE({
            event: 'task_event',
            data: JSON.stringify(event),
            id: event.id,
          });
          lastEventId = event.id;

          // End stream on completion
          if (event.eventType === 'completed') {
            await stream.writeSSE({
              event: 'stream_end',
              data: JSON.stringify({ type: 'stream_end' }),
            });
            stopped = true;
            clearInterval(interval);
            return;
          }
        }
      } catch {
        // Client disconnected or error
        stopped = true;
        clearInterval(interval);
      }
    }, 2000);

    // Keep-alive ping every 30 seconds
    const pingInterval = setInterval(async () => {
      if (stopped) return;
      try {
        await stream.writeSSE({ event: 'ping', data: '{}' });
      } catch {
        stopped = true;
        clearInterval(pingInterval);
        clearInterval(interval);
      }
    }, 30_000);

    // Clean up on disconnect
    stream.onAbort(() => {
      stopped = true;
      clearInterval(interval);
      clearInterval(pingInterval);
    });

    // Hold stream open
    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });
  });
});

// ── POST /:taskId/events/:eventId/respond ─────────────────────────────
// Respond to a question or approval request

const respondSchema = z.object({
  response: z.union([z.record(z.unknown()), z.string()]),
});

taskEventRoutes.post(
  '/:taskId/events/:eventId/respond',
  zValidator('json', respondSchema),
  async (c) => {
    const userId = getUserId(c);
    const { taskId, eventId } = c.req.param();
    const body = c.req.valid('json');

    const task = await getAgentTask(taskId, userId);
    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }

    const updated = await respondToTaskEvent({
      eventId,
      response: body.response,
    });

    if (!updated) {
      return c.json({ error: 'Event not found or already responded' }, 404);
    }

    return c.json(updated);
  },
);

// ── POST /:taskId/redirect ────────────────────────────────────────────
// Inject a redirect instruction into a running task

const redirectSchema = z.object({
  instruction: z.string().min(1).max(5000),
});

taskEventRoutes.post(
  '/:taskId/redirect',
  zValidator('json', redirectSchema),
  async (c) => {
    const userId = getUserId(c);
    const { taskId } = c.req.param();
    const body = c.req.valid('json');

    const task = await getAgentTask(taskId, userId);
    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }

    const event = await createRedirectEvent({
      taskId,
      instruction: body.instruction,
    });

    return c.json(event, 201);
  },
);

// ── GET /:taskId/summary ──────────────────────────────────────────────
// High-level task summary

taskEventRoutes.get('/:taskId/summary', async (c) => {
  const userId = getUserId(c);
  const { taskId } = c.req.param();

  const task = await getAgentTask(taskId, userId);
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const summary = await getTaskEventSummary(taskId);

  const elapsed = task.startedAt
    ? Math.round(((task.completedAt ?? new Date()).getTime() - task.startedAt.getTime()) / 1000)
    : null;

  return c.json({
    task_id: task.id,
    status: task.status,
    total_events: summary.totalEvents,
    last_thinking: summary.lastThinking
      ? (typeof summary.lastThinking.content === 'string'
        ? summary.lastThinking.content
        : (summary.lastThinking.content as Record<string, unknown>)?.text ?? null)
      : null,
    last_decision: summary.lastDecision
      ? (typeof summary.lastDecision.content === 'string'
        ? summary.lastDecision.content
        : (summary.lastDecision.content as Record<string, unknown>)?.text ?? null)
      : null,
    last_progress: summary.lastProgress
      ? (typeof summary.lastProgress.content === 'string'
        ? summary.lastProgress.content
        : (summary.lastProgress.content as Record<string, unknown>)?.text ?? null)
      : null,
    pending_questions: summary.pendingQuestions.length,
    errors: summary.errors.length,
    files_changed: summary.fileChanges,
    elapsed_seconds: elapsed,
  });
});

export { taskEventRoutes };
