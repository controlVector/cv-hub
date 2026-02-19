import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth';
import {
  registerExecutor,
  getExecutor,
  listExecutors,
  heartbeat,
  updateExecutorStatus,
  unregisterExecutor,
  markExecutorTaskComplete,
} from '../services/executor.service';
import {
  claimNextTask,
  startTask,
  completeTask,
  failTask,
} from '../services/agent-task.service';

import type { AppEnv } from '../app';

const executors = new Hono<AppEnv>();

// All executor routes require authentication (JWT session or PAT)
executors.use('*', requireAuth);

// Helper to get userId from context
function getUserId(c: any): string {
  const userId = c.get('userId');
  if (!userId) throw new Error('Not authenticated');
  return userId;
}

// ============================================================================
// POST /api/v1/executors — Register a new executor
// ============================================================================

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['claude_code', 'cv_git', 'custom']).optional(),
  capabilities: z
    .object({
      languages: z.array(z.string()).optional(),
      tools: z.array(z.string()).optional(),
      maxConcurrentTasks: z.number().optional(),
      supportsDocker: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
  workspace_root: z.string().optional(),
  repository_id: z.string().uuid().optional(),
});

executors.post('/', zValidator('json', registerSchema), async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  const { executor, registrationToken } = await registerExecutor({
    userId,
    name: body.name,
    type: body.type,
    capabilities: body.capabilities,
    workspaceRoot: body.workspace_root,
    repositoryId: body.repository_id,
  });

  return c.json(
    {
      executor: {
        id: executor.id,
        name: executor.name,
        type: executor.type,
        status: executor.status,
        created_at: executor.createdAt,
      },
      registration_token: registrationToken,
      message:
        'Executor registered. Save the registration_token — use it for heartbeats.',
    },
    201,
  );
});

// ============================================================================
// GET /api/v1/executors — List executors
// ============================================================================

executors.get('/', async (c) => {
  const userId = getUserId(c);
  const list = await listExecutors(userId);

  return c.json({
    executors: list.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      status: e.status,
      workspace_root: e.workspaceRoot,
      repository_id: e.repositoryId,
      last_heartbeat_at: e.lastHeartbeatAt,
      last_task_at: e.lastTaskAt,
      created_at: e.createdAt,
    })),
  });
});

// ============================================================================
// GET /api/v1/executors/:id — Get executor details
// ============================================================================

executors.get('/:id', async (c) => {
  const userId = getUserId(c);
  const executor = await getExecutor(c.req.param('id'), userId);

  if (!executor) {
    return c.json({ error: 'Executor not found' }, 404);
  }

  return c.json({
    executor: {
      id: executor.id,
      name: executor.name,
      type: executor.type,
      status: executor.status,
      capabilities: executor.capabilities,
      workspace_root: executor.workspaceRoot,
      repository_id: executor.repositoryId,
      last_heartbeat_at: executor.lastHeartbeatAt,
      last_task_at: executor.lastTaskAt,
      created_at: executor.createdAt,
      updated_at: executor.updatedAt,
    },
  });
});

// ============================================================================
// POST /api/v1/executors/:id/heartbeat — Send heartbeat
// ============================================================================

executors.post('/:id/heartbeat', async (c) => {
  const userId = getUserId(c);
  const executor = await heartbeat(c.req.param('id'), userId);

  if (!executor) {
    return c.json({ error: 'Executor not found' }, 404);
  }

  return c.json({ status: 'ok', executor_status: executor.status });
});

// ============================================================================
// PATCH /api/v1/executors/:id/status — Update executor status
// ============================================================================

const statusSchema = z.object({
  status: z.enum(['online', 'offline', 'busy', 'error']),
});

executors.patch(
  '/:id/status',
  zValidator('json', statusSchema),
  async (c) => {
    const userId = getUserId(c);
    const { status } = c.req.valid('json');

    const executor = await updateExecutorStatus(
      c.req.param('id'),
      userId,
      status,
    );

    if (!executor) {
      return c.json({ error: 'Executor not found' }, 404);
    }

    return c.json({ executor_id: executor.id, status: executor.status });
  },
);

// ============================================================================
// POST /api/v1/executors/:id/poll — Poll for next available task
// ============================================================================

executors.post('/:id/poll', async (c) => {
  const userId = getUserId(c);
  const executorId = c.req.param('id');

  // Verify executor exists and belongs to user
  const executor = await getExecutor(executorId, userId);
  if (!executor) {
    return c.json({ error: 'Executor not found' }, 404);
  }

  // Update heartbeat while polling
  await heartbeat(executorId, userId);

  // Try to claim the next task
  const task = await claimNextTask(executorId, userId);

  if (!task) {
    return c.json({ task: null, message: 'No tasks available' });
  }

  return c.json({
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      task_type: task.taskType,
      priority: task.priority,
      status: task.status,
      input: task.input,
      repository_id: task.repositoryId,
      branch: task.branch,
      file_paths: task.filePaths,
      thread_id: task.threadId,
      parent_task_id: task.parentTaskId,
      timeout_at: task.timeoutAt,
      metadata: task.metadata,
    },
  });
});

// ============================================================================
// POST /api/v1/executors/:id/tasks/:taskId/start — Mark task as running
// ============================================================================

executors.post('/:id/tasks/:taskId/start', async (c) => {
  const userId = getUserId(c);
  const executorId = c.req.param('id');
  const taskId = c.req.param('taskId');

  // Verify executor ownership
  const executor = await getExecutor(executorId, userId);
  if (!executor) {
    return c.json({ error: 'Executor not found' }, 404);
  }

  // Update executor status to busy
  await updateExecutorStatus(executorId, userId, 'busy');

  const task = await startTask(taskId, executorId);
  if (!task) {
    return c.json({ error: 'Task not found or not assigned to this executor' }, 404);
  }

  return c.json({
    task_id: task.id,
    status: task.status,
    started_at: task.startedAt,
  });
});

// ============================================================================
// POST /api/v1/executors/:id/tasks/:taskId/complete — Submit task result
// ============================================================================

const completeSchema = z.object({
  summary: z.string().optional(),
  files_modified: z.array(z.string()).optional(),
  files_created: z.array(z.string()).optional(),
  output: z.string().optional(),
  artifacts: z
    .array(
      z.object({
        name: z.string(),
        path: z.string(),
        type: z.string(),
      }),
    )
    .optional(),
});

executors.post(
  '/:id/tasks/:taskId/complete',
  zValidator('json', completeSchema),
  async (c) => {
    const userId = getUserId(c);
    const executorId = c.req.param('id');
    const taskId = c.req.param('taskId');
    const body = c.req.valid('json');

    const executor = await getExecutor(executorId, userId);
    if (!executor) {
      return c.json({ error: 'Executor not found' }, 404);
    }

    const task = await completeTask(taskId, executorId, {
      summary: body.summary,
      filesModified: body.files_modified,
      filesCreated: body.files_created,
      output: body.output,
      artifacts: body.artifacts,
    });

    if (!task) {
      return c.json(
        { error: 'Task not found or not assigned to this executor' },
        404,
      );
    }

    // Mark executor as available again
    await markExecutorTaskComplete(executorId);

    return c.json({
      task_id: task.id,
      status: task.status,
      completed_at: task.completedAt,
    });
  },
);

// ============================================================================
// POST /api/v1/executors/:id/tasks/:taskId/fail — Report task failure
// ============================================================================

const failSchema = z.object({
  error: z.string(),
});

executors.post(
  '/:id/tasks/:taskId/fail',
  zValidator('json', failSchema),
  async (c) => {
    const userId = getUserId(c);
    const executorId = c.req.param('id');
    const taskId = c.req.param('taskId');
    const body = c.req.valid('json');

    const executor = await getExecutor(executorId, userId);
    if (!executor) {
      return c.json({ error: 'Executor not found' }, 404);
    }

    const task = await failTask(taskId, executorId, body.error);

    if (!task) {
      return c.json(
        { error: 'Task not found or not assigned to this executor' },
        404,
      );
    }

    // Mark executor as available again
    await markExecutorTaskComplete(executorId);

    return c.json({
      task_id: task.id,
      status: task.status,
      completed_at: task.completedAt,
      error: task.error,
    });
  },
);

// ============================================================================
// DELETE /api/v1/executors/:id — Unregister executor
// ============================================================================

executors.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const deleted = await unregisterExecutor(c.req.param('id'), userId);

  if (!deleted) {
    return c.json({ error: 'Executor not found' }, 404);
  }

  return c.json({ success: true });
});

export { executors as executorRoutes };
