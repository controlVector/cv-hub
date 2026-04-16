import { eq, and, desc, inArray, isNull, or, lt } from 'drizzle-orm';
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
  targetExecutorId?: string;
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
      targetExecutorId: params.targetExecutorId,
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

export async function updateAgentTaskStatus(
  taskId: string,
  userId: string,
  status: 'pending' | 'queued' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled',
): Promise<AgentTask | null> {
  const task = await getAgentTask(taskId, userId);
  if (!task) return null;

  const now = new Date();
  const updates: Partial<{
    status: typeof status;
    startedAt: Date;
    completedAt: Date;
    updatedAt: Date;
  }> = { status, updatedAt: now };

  if (status === 'running' && !task.startedAt) {
    updates.startedAt = now;
  }
  if (['completed', 'failed', 'cancelled'].includes(status)) {
    updates.completedAt = now;
  }

  const [updated] = await db
    .update(agentTasks)
    .set(updates)
    .where(eq(agentTasks.id, taskId))
    .returning();

  return updated;
}

// ==================== Executor-facing operations ====================

const STALE_THRESHOLD_MS = 60_000; // Tasks pending >60s can be rescued by any executor

/**
 * Claim the next pending task for an executor using 4-pass priority routing:
 *
 *   Pass 1: Direct targeting — task explicitly targets THIS executor by ID
 *   Pass 2: Repository affinity — task's repositoryId matches executor's repositoryId
 *   Pass 3: Unscoped tasks — no repositoryId AND no targetExecutorId (any executor can claim)
 *   Pass 4: Stale rescue — any task pending >60s (prevents stuck tasks)
 */
export async function claimNextTask(
  executorId: string,
  userId: string,
): Promise<AgentTask | null> {
  // Step 0: Look up the calling executor to know its identity + affinity
  const executor = await db.query.agentExecutors.findFirst({
    where: and(
      eq(agentExecutors.id, executorId),
      eq(agentExecutors.userId, userId),
    ),
  });
  if (!executor) return null;

  // Atomic claim helper — prevents double-claims from concurrent polls
  async function tryClaim(task: AgentTask): Promise<AgentTask | null> {
    const [claimed] = await db
      .update(agentTasks)
      .set({ executorId, status: 'assigned', updatedAt: new Date() })
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

  // PASS 1: Direct targeting — task explicitly targets THIS executor by ID
  {
    const targeted = await db.query.agentTasks.findFirst({
      where: and(
        eq(agentTasks.userId, userId),
        eq(agentTasks.status, 'pending'),
        isNull(agentTasks.executorId),
        eq(agentTasks.targetExecutorId, executorId),
      ),
      orderBy: [desc(agentTasks.priority), desc(agentTasks.createdAt)],
    });
    if (targeted) {
      const claimed = await tryClaim(targeted);
      if (claimed) return claimed;
    }
  }

  // PASS 2: Repository affinity — task's repositoryId matches executor's repositoryId
  if (executor.repositoryId) {
    const affinityTask = await db.query.agentTasks.findFirst({
      where: and(
        eq(agentTasks.userId, userId),
        eq(agentTasks.status, 'pending'),
        isNull(agentTasks.executorId),
        isNull(agentTasks.targetExecutorId),
        eq(agentTasks.repositoryId, executor.repositoryId),
      ),
      orderBy: [desc(agentTasks.priority), desc(agentTasks.createdAt)],
    });
    if (affinityTask) {
      const claimed = await tryClaim(affinityTask);
      if (claimed) return claimed;
    }
  }

  // PASS 3: Unscoped tasks — no repositoryId AND no targetExecutorId (any executor can claim)
  {
    const unscopedTask = await db.query.agentTasks.findFirst({
      where: and(
        eq(agentTasks.userId, userId),
        eq(agentTasks.status, 'pending'),
        isNull(agentTasks.executorId),
        isNull(agentTasks.repositoryId),
        isNull(agentTasks.targetExecutorId),
      ),
      orderBy: [desc(agentTasks.priority), desc(agentTasks.createdAt)],
    });
    if (unscopedTask) {
      const claimed = await tryClaim(unscopedTask);
      if (claimed) return claimed;
    }
  }

  // PASS 4: Stale rescue — repo-scoped or targeted tasks pending >60s (prevents stuck tasks)
  {
    const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    const staleTask = await db.query.agentTasks.findFirst({
      where: and(
        eq(agentTasks.userId, userId),
        eq(agentTasks.status, 'pending'),
        isNull(agentTasks.executorId),
        lt(agentTasks.createdAt, staleCutoff),
      ),
      orderBy: [desc(agentTasks.priority), desc(agentTasks.createdAt)],
    });
    if (staleTask) {
      const claimed = await tryClaim(staleTask);
      if (claimed) return claimed;
    }
  }

  return null;
}

/**
 * Mark a task as running (executor started working on it).
 * userId provides defense-in-depth (routes also validate executor ownership).
 */
export async function startTask(
  taskId: string,
  executorId: string,
  userId?: string,
): Promise<AgentTask | null> {
  const conditions = [eq(agentTasks.id, taskId), eq(agentTasks.executorId, executorId)];
  if (userId) conditions.push(eq(agentTasks.userId, userId));

  const [updated] = await db
    .update(agentTasks)
    .set({
      status: 'running',
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();

  return updated || null;
}

/**
 * Complete a task with results.
 * userId provides defense-in-depth (routes also validate executor ownership).
 */
export async function completeTask(
  taskId: string,
  executorId: string,
  result: TaskResult,
  userId?: string,
): Promise<AgentTask | null> {
  const conditions = [eq(agentTasks.id, taskId), eq(agentTasks.executorId, executorId)];
  if (userId) conditions.push(eq(agentTasks.userId, userId));

  const [updated] = await db
    .update(agentTasks)
    .set({
      status: 'completed',
      result,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();

  // Pipeline job completion hook — advance the DAG if this task is linked to a pipeline job
  if (updated) {
    onTaskTerminal(taskId, 'success').catch(() => {});
  }

  return updated || null;
}

/**
 * Update task activity timestamp (heartbeat while running).
 * userId provides defense-in-depth (routes also validate executor ownership).
 */
export async function taskHeartbeat(
  taskId: string,
  executorId: string,
  userId?: string,
): Promise<AgentTask | null> {
  const conditions = [eq(agentTasks.id, taskId), eq(agentTasks.executorId, executorId)];
  if (userId) conditions.push(eq(agentTasks.userId, userId));

  const [updated] = await db
    .update(agentTasks)
    .set({
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();

  return updated || null;
}

/**
 * Fail a task with an error message.
 * userId provides defense-in-depth (routes also validate executor ownership).
 */
export async function failTask(
  taskId: string,
  executorId: string,
  error: string,
  userId?: string,
): Promise<AgentTask | null> {
  const conditions = [eq(agentTasks.id, taskId), eq(agentTasks.executorId, executorId)];
  if (userId) conditions.push(eq(agentTasks.userId, userId));

  const [updated] = await db
    .update(agentTasks)
    .set({
      status: 'failed',
      error,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();

  // Pipeline job failure hook
  if (updated) {
    onTaskTerminal(taskId, 'failure').catch(() => {});
  }

  return updated || null;
}

// ==================== Pipeline Job Bridge ====================

/**
 * Called when a task reaches a terminal state (completed/failed).
 * If the task is linked to a pipeline job, updates the job status
 * and triggers DAG advancement for the pipeline run.
 */
async function onTaskTerminal(
  taskId: string,
  outcome: 'success' | 'failure',
): Promise<void> {
  try {
    const { pipelineJobs } = await import('../db/schema/ci-cd');
    const { updateJobStatus, checkAndAdvanceRun } = await import('./ci/pipeline.service');

    // Check if this task is linked to a pipeline job
    const job = await db.query.pipelineJobs.findFirst({
      where: eq(pipelineJobs.taskId, taskId),
    });

    if (!job) return; // Not a pipeline task

    // updateJobStatus auto-populates completedAt and durationMs (when
    // startedAt is known) for terminal statuses.
    await updateJobStatus(job.id, outcome);

    // Advance the pipeline DAG (dispatch next jobs or mark run as complete)
    if (job.runId) {
      await checkAndAdvanceRun(job.runId);
    }
  } catch (err: any) {
    // Non-fatal — don't break task completion if pipeline bridge fails
    console.warn(`[pipeline-bridge] onTaskTerminal failed for task ${taskId}: ${err.message}`);
  }
}
