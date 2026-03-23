/**
 * Task Events Service
 * Create, query, respond to, and summarize structured streaming events
 * for the executor ↔ planner bidirectional thinking stream.
 */

import { eq, and, gt, desc, asc, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  taskEvents,
  agentTasks,
  type TaskEvent,
} from '../db/schema';

// ==================== Create Event ====================

export async function createTaskEvent(params: {
  taskId: string;
  eventType: string;
  content: Record<string, unknown> | string;
  needsResponse?: boolean;
}): Promise<TaskEvent> {
  const [event] = await db
    .insert(taskEvents)
    .values({
      taskId: params.taskId,
      eventType: params.eventType as any,
      content: params.content,
      needsResponse: params.needsResponse ?? false,
    })
    .returning();

  // If this event needs a response, set parent task to waiting_for_input
  if (params.needsResponse) {
    await db
      .update(agentTasks)
      .set({
        status: 'waiting_for_input',
        updatedAt: new Date(),
      })
      .where(eq(agentTasks.id, params.taskId));
  }

  return event;
}

// ==================== Query Events ====================

export async function getTaskEvents(params: {
  taskId: string;
  afterId?: string;
  afterTimestamp?: string;
  limit?: number;
}): Promise<TaskEvent[]> {
  const conditions = [eq(taskEvents.taskId, params.taskId)];

  if (params.afterId) {
    // Get the timestamp of the afterId event, then return events after it
    const refEvent = await db.query.taskEvents.findFirst({
      where: eq(taskEvents.id, params.afterId),
      columns: { createdAt: true },
    });
    if (refEvent) {
      conditions.push(gt(taskEvents.createdAt, refEvent.createdAt));
    }
  } else if (params.afterTimestamp) {
    conditions.push(gt(taskEvents.createdAt, new Date(params.afterTimestamp)));
  }

  return db.query.taskEvents.findMany({
    where: and(...conditions),
    orderBy: [asc(taskEvents.createdAt)],
    limit: Math.min(params.limit ?? 50, 200),
  });
}

// ==================== Pending Questions ====================

export async function getPendingEventQuestions(taskId: string): Promise<TaskEvent[]> {
  return db.query.taskEvents.findMany({
    where: and(
      eq(taskEvents.taskId, taskId),
      eq(taskEvents.needsResponse, true),
      isNull(taskEvents.respondedAt),
    ),
    orderBy: [asc(taskEvents.createdAt)],
  });
}

// ==================== Respond to Event ====================

export async function respondToTaskEvent(params: {
  eventId: string;
  response: Record<string, unknown> | string;
}): Promise<TaskEvent | null> {
  const [updated] = await db
    .update(taskEvents)
    .set({
      response: params.response,
      respondedAt: new Date(),
    })
    .where(
      and(
        eq(taskEvents.id, params.eventId),
        isNull(taskEvents.respondedAt), // Prevent double-response
      ),
    )
    .returning();

  if (!updated) return null;

  // Check if there are remaining unanswered events for this task
  const pending = await db.query.taskEvents.findFirst({
    where: and(
      eq(taskEvents.taskId, updated.taskId),
      eq(taskEvents.needsResponse, true),
      isNull(taskEvents.respondedAt),
    ),
  });

  // If all questions answered, set task back to running
  if (!pending) {
    await db
      .update(agentTasks)
      .set({
        status: 'running',
        updatedAt: new Date(),
      })
      .where(eq(agentTasks.id, updated.taskId));
  }

  return updated;
}

// ==================== Redirect ====================

export async function createRedirectEvent(params: {
  taskId: string;
  instruction: string;
}): Promise<TaskEvent> {
  return createTaskEvent({
    taskId: params.taskId,
    eventType: 'redirect',
    content: { instruction: params.instruction },
  });
}

// ==================== Task Summary ====================

export async function getTaskEventSummary(taskId: string): Promise<{
  totalEvents: number;
  lastThinking?: TaskEvent;
  lastDecision?: TaskEvent;
  lastProgress?: TaskEvent;
  pendingQuestions: TaskEvent[];
  errors: TaskEvent[];
  fileChanges: string[];
}> {
  // Total count
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId));

  // Last of each type
  const lastThinking = await db.query.taskEvents.findFirst({
    where: and(eq(taskEvents.taskId, taskId), eq(taskEvents.eventType, 'thinking')),
    orderBy: [desc(taskEvents.createdAt)],
  });

  const lastDecision = await db.query.taskEvents.findFirst({
    where: and(eq(taskEvents.taskId, taskId), eq(taskEvents.eventType, 'decision')),
    orderBy: [desc(taskEvents.createdAt)],
  });

  const lastProgress = await db.query.taskEvents.findFirst({
    where: and(eq(taskEvents.taskId, taskId), eq(taskEvents.eventType, 'progress')),
    orderBy: [desc(taskEvents.createdAt)],
  });

  // Pending questions
  const pendingQuestions = await getPendingEventQuestions(taskId);

  // Errors
  const errors = await db.query.taskEvents.findMany({
    where: and(eq(taskEvents.taskId, taskId), eq(taskEvents.eventType, 'error')),
    orderBy: [desc(taskEvents.createdAt)],
    limit: 10,
  });

  // File changes (extract paths from file_change events)
  const fileChangeEvents = await db.query.taskEvents.findMany({
    where: and(eq(taskEvents.taskId, taskId), eq(taskEvents.eventType, 'file_change')),
    columns: { content: true },
  });
  const fileChanges = fileChangeEvents
    .map((e) => {
      const c = e.content as Record<string, unknown>;
      return (c?.path as string) ?? null;
    })
    .filter((p): p is string => p !== null);

  return {
    totalEvents: count,
    lastThinking: lastThinking ?? undefined,
    lastDecision: lastDecision ?? undefined,
    lastProgress: lastProgress ?? undefined,
    pendingQuestions,
    errors,
    fileChanges,
  };
}
