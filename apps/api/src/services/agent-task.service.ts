import { eq, and, desc, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../db';
import {
  agentTasks,
  agentExecutors,
  type AgentTask,
  type NewAgentTask,
  type TaskInput,
  type TaskResult,
} from '../db/schema';

// ==================== Task CRUD ====================

export async function createAgentTask(params: {
  userId: string;
  title: string;
  description?: string;
  taskType?: 'code_change' | 'review' | 'debug' | 'research' | 'deploy' | 'test' | 'custom';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  input?: TaskInput;
  repositoryId?: string;
  branch?: string;
  filePaths?: string[];
  threadId?: string;
  mcpSessionId?: string;
  parentTaskId?: string;
  timeoutMinutes?: number;
  metadata?: Record<string, unknown>;
}): Promise<AgentTask> {
  const timeoutAt = params.timeoutMinutes
    ? new Date(Date.now() + params.timeoutMinutes * 60 * 1000)
    : new Date(Date.now() + 30 * 60 * 1000); // Default 30 min timeout

  const [task] = await db
    .insert(agentTasks)
    .values({
      userId: params.userId,
      title: params.title,
      description: params.description,
      taskType: params.taskType || 'custom',
      priority: params.priority || 'medium',
      status: 'pending',
      input: params.input,
      repositoryId: params.repositoryId,
      branch: params.branch,
      filePaths: params.filePaths,
      threadId: params.threadId,
      mcpSessionId: params.mcpSessionId,
      parentTaskId: params.parentTaskId,
      timeoutAt,
      metadata: params.metadata,
    })
    .returning();

  return task;
}

export async function getAgentTask(
  taskId: string,
  userId: string,
): Promise<AgentTask | undefined> {
  return db.query.agentTasks.findFirst({
    where: and(eq(agentTasks.id, taskId), eq(agentTasks.userId, userId)),
  });
}

export async function listAgentTasks(params: {
  userId: string;
  status?: string[];
  taskType?: string;
  repositoryId?: string;
  threadId?: string;
  limit?: number;
  offset?: number;
}): Promise<AgentTask[]> {
  const conditions = [eq(agentTasks.userId, params.userId)];

  if (params.status && params.status.length > 0) {
    conditions.push(
      inArray(agentTasks.status, params.status as any),
    );
  }

  if (params.taskType) {
    conditions.push(eq(agentTasks.taskType, params.taskType as any));
  }

  if (params.repositoryId) {
    conditions.push(eq(agentTasks.repositoryId, params.repositoryId));
  }

  if (params.threadId) {
    conditions.push(eq(agentTasks.threadId, params.threadId));
  }

  return db.query.agentTasks.findMany({
    where: and(...conditions),
    orderBy: [desc(agentTasks.createdAt)],
    limit: params.limit || 20,
    offset: params.offset || 0,
  });
}

export async function cancelAgentTask(
  taskId: string,
  userId: string,
): Promise<AgentTask | null> {
  const task = await getAgentTask(taskId, userId);
  if (!task) return null;

  // Only cancel tasks that aren't already terminal
  if (['completed', 'failed', 'cancelled'].includes(task.status)) {
    return task;
  }

  const [updated] = await db
    .update(agentTasks)
    .set({
      status: 'cancelled',
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentTasks.id, taskId))
    .returning();

  return updated;
}

// ==================== Executor-facing operations ====================

/**
 * Claim the next pending task for an executor.
 * Used by executor polling (A.5).
 */
export async function claimNextTask(
  executorId: string,
  userId: string,
): Promise<AgentTask | null> {
  // Find the highest-priority pending task for this user
  const task = await db.query.agentTasks.findFirst({
    where: and(
      eq(agentTasks.userId, userId),
      eq(agentTasks.status, 'pending'),
      isNull(agentTasks.executorId),
    ),
    orderBy: [desc(agentTasks.priority), desc(agentTasks.createdAt)],
  });

  if (!task) return null;

  // Atomically assign and mark as running
  const [claimed] = await db
    .update(agentTasks)
    .set({
      executorId,
      status: 'assigned',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentTasks.id, task.id),
        eq(agentTasks.status, 'pending'),
        isNull(agentTasks.executorId),
      ),
    )
    .returning();

  return claimed || null;
}

/**
 * Mark a task as running (executor started working on it).
 */
export async function startTask(
  taskId: string,
  executorId: string,
): Promise<AgentTask | null> {
  const [updated] = await db
    .update(agentTasks)
    .set({
      status: 'running',
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(agentTasks.id, taskId), eq(agentTasks.executorId, executorId)),
    )
    .returning();

  return updated || null;
}

/**
 * Complete a task with results.
 */
export async function completeTask(
  taskId: string,
  executorId: string,
  result: TaskResult,
): Promise<AgentTask | null> {
  const [updated] = await db
    .update(agentTasks)
    .set({
      status: 'completed',
      result,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(agentTasks.id, taskId), eq(agentTasks.executorId, executorId)),
    )
    .returning();

  return updated || null;
}

/**
 * Fail a task with an error message.
 */
export async function failTask(
  taskId: string,
  executorId: string,
  error: string,
): Promise<AgentTask | null> {
  const [updated] = await db
    .update(agentTasks)
    .set({
      status: 'failed',
      error,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(agentTasks.id, taskId), eq(agentTasks.executorId, executorId)),
    )
    .returning();

  return updated || null;
}
