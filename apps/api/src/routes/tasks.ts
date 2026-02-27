import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth';
import {
  createAgentTask,
  getAgentTask,
  listAgentTasks,
  cancelAgentTask,
  updateAgentTaskStatus,
} from '../services/agent-task.service';

import type { AppEnv } from '../app';

const tasks = new Hono<AppEnv>();

tasks.use('*', requireAuth);

function getUserId(c: any): string {
  const userId = c.get('userId');
  if (!userId) throw new Error('Not authenticated');
  return userId;
}

// ============================================================================
// GET /api/v1/tasks — List tasks (board view)
// ============================================================================

const listSchema = z.object({
  status: z.string().optional(),
  task_type: z.string().optional(),
  repository_id: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
  offset: z.coerce.number().min(0).optional(),
});

tasks.get('/', zValidator('query', listSchema), async (c) => {
  const userId = getUserId(c);
  const query = c.req.valid('query');

  const statusFilter = query.status ? query.status.split(',') : undefined;

  const items = await listAgentTasks({
    userId,
    status: statusFilter,
    taskType: query.task_type,
    repositoryId: query.repository_id,
    limit: query.limit || 100,
    offset: query.offset || 0,
  });

  return c.json({
    tasks: items.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      task_type: t.taskType,
      status: t.status,
      priority: t.priority,
      repository_id: t.repositoryId,
      branch: t.branch,
      thread_id: t.threadId,
      executor_id: t.executorId,
      result: t.result,
      error: t.error,
      metadata: t.metadata,
      started_at: t.startedAt,
      completed_at: t.completedAt,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
    })),
  });
});

// ============================================================================
// GET /api/v1/tasks/:id — Get single task
// ============================================================================

tasks.get('/:id', async (c) => {
  const userId = getUserId(c);
  const task = await getAgentTask(c.req.param('id'), userId);

  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  return c.json({
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      task_type: task.taskType,
      status: task.status,
      priority: task.priority,
      input: task.input,
      result: task.result,
      error: task.error,
      repository_id: task.repositoryId,
      branch: task.branch,
      file_paths: task.filePaths,
      thread_id: task.threadId,
      executor_id: task.executorId,
      parent_task_id: task.parentTaskId,
      metadata: task.metadata,
      started_at: task.startedAt,
      completed_at: task.completedAt,
      timeout_at: task.timeoutAt,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
    },
  });
});

// ============================================================================
// POST /api/v1/tasks — Create a new task
// ============================================================================

const createSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  task_type: z
    .enum(['code_change', 'review', 'debug', 'research', 'deploy', 'test', 'custom'])
    .optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  repository_id: z.string().uuid().optional(),
  branch: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

tasks.post('/', zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  const task = await createAgentTask({
    userId,
    title: body.title,
    description: body.description,
    taskType: body.task_type,
    priority: body.priority,
    repositoryId: body.repository_id,
    branch: body.branch,
    metadata: body.metadata,
  });

  return c.json(
    {
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        task_type: task.taskType,
        status: task.status,
        priority: task.priority,
        repository_id: task.repositoryId,
        created_at: task.createdAt,
      },
    },
    201,
  );
});

// ============================================================================
// PATCH /api/v1/tasks/:id — Update task (status change for board drag-and-drop)
// ============================================================================

const updateSchema = z.object({
  status: z
    .enum(['pending', 'queued', 'assigned', 'running', 'completed', 'failed', 'cancelled'])
    .optional(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

tasks.patch('/:id', zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c);
  const taskId = c.req.param('id');
  const body = c.req.valid('json');

  if (body.status) {
    const updated = await updateAgentTaskStatus(taskId, userId, body.status);
    if (!updated) {
      return c.json({ error: 'Task not found' }, 404);
    }
    return c.json({
      task: {
        id: updated.id,
        title: updated.title,
        status: updated.status,
        priority: updated.priority,
        started_at: updated.startedAt,
        completed_at: updated.completedAt,
        updated_at: updated.updatedAt,
      },
    });
  }

  return c.json({ error: 'No update fields provided' }, 400);
});

// ============================================================================
// DELETE /api/v1/tasks/:id — Cancel a task
// ============================================================================

tasks.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const task = await cancelAgentTask(c.req.param('id'), userId);

  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  return c.json({ task: { id: task.id, status: task.status } });
});

export { tasks as taskRoutes };
