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
  updateExecutor,
  unregisterExecutor,
  markExecutorTaskComplete,
} from '../services/executor.service';
import {
  claimNextTask,
  startTask,
  completeTask,
  failTask,
  taskHeartbeat,
} from '../services/agent-task.service';
import { getUserOrganizations, getUserOrgRole } from '../services/organization.service';
import { getUserAccessibleRepositories } from '../services/repository.service';

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
// Org resolution: determine which org to attach an executor to
// ============================================================================

export type OrgResolutionResult =
  | { orgId: string | undefined; error?: never }
  | { orgId?: never; error: { message: string; organizations?: Array<{ id: string; name: string; slug: string }> } };

/**
 * Resolve the organization for an executor registration.
 *
 * Priority:
 *  1. Explicit organization_id in request body → validate membership → use it
 *  2. PAT is org-scoped → use patOrgId
 *  3. User has exactly 1 org → auto-resolve
 *  4. User has 0 orgs → undefined (no org)
 *  5. User has 2+ orgs → error with org list
 */
export async function resolveOrganizationId(
  userId: string,
  explicitOrgId?: string,
  patOrgId?: string,
): Promise<OrgResolutionResult> {
  // 1. Explicit org_id
  if (explicitOrgId) {
    const role = await getUserOrgRole(explicitOrgId, userId);
    if (!role) {
      return { error: { message: 'You are not a member of the specified organization' } };
    }
    return { orgId: explicitOrgId };
  }

  // 2. PAT org scope
  if (patOrgId) {
    return { orgId: patOrgId };
  }

  // 3-5. Look up user's orgs
  const userOrgs = await getUserOrganizations(userId);
  if (userOrgs.length === 0) {
    return { orgId: undefined };
  }
  if (userOrgs.length === 1) {
    return { orgId: userOrgs[0].id };
  }
  // 2+ orgs — ambiguous
  return {
    error: {
      message: 'Multiple organizations found. Specify organization_id or use an org-scoped PAT.',
      organizations: userOrgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug })),
    },
  };
}

// ============================================================================
// POST /api/v1/executors — Register a new executor
// ============================================================================

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  machine_name: z.string().min(1).max(100).optional(),
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
  repos: z.array(z.string()).optional(),
  organization_id: z.string().uuid().optional(),
  repository_id: z.string().uuid().optional(),
});

executors.post('/', zValidator('json', registerSchema), async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');
  const patOrgId = c.get('patOrgId');

  // Resolve org server-side
  const orgResult = await resolveOrganizationId(userId, body.organization_id, patOrgId);
  if (orgResult.error) {
    return c.json({ error: orgResult.error }, 400);
  }

  // Resolve repository_id from repos slug if not explicitly provided
  let repositoryId = body.repository_id;
  if (!repositoryId && body.repos?.length === 1) {
    try {
      const userRepos = await getUserAccessibleRepositories(userId, {
        search: body.repos[0],
        limit: 5,
      });
      const match = userRepos.find((r) => r.slug === body.repos![0]);
      if (match) {
        repositoryId = match.id;
      }
    } catch {
      // Non-fatal — registration continues without repository_id
    }
  }

  const { executor, registrationToken } = await registerExecutor({
    userId,
    name: body.name,
    machineName: body.machine_name,
    type: body.type,
    capabilities: body.capabilities,
    workspaceRoot: body.workspace_root,
    repos: body.repos,
    organizationId: orgResult.orgId,
    repositoryId,
  });

  return c.json(
    {
      executor: {
        id: executor.id,
        name: executor.name,
        machine_name: executor.machineName,
        type: executor.type,
        status: executor.status,
        repos: executor.repos,
        organization_id: executor.organizationId,
        repository_id: executor.repositoryId,
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
      machine_name: e.machineName,
      type: e.type,
      status: e.status,
      repos: e.repos,
      workspace_root: e.workspaceRoot,
      organization_id: e.organizationId,
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
      machine_name: executor.machineName,
      type: executor.type,
      status: executor.status,
      capabilities: executor.capabilities,
      repos: executor.repos,
      workspace_root: executor.workspaceRoot,
      organization_id: executor.organizationId,
      repository_id: executor.repositoryId,
      last_heartbeat_at: executor.lastHeartbeatAt,
      last_task_at: executor.lastTaskAt,
      created_at: executor.createdAt,
      updated_at: executor.updatedAt,
    },
  });
});

// ============================================================================
// PATCH /api/v1/executors/:id — Update executor (rename)
// ============================================================================

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  machine_name: z.string().min(1).max(100).optional(),
});

executors.patch('/:id', zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');

  if (!body.name && !body.machine_name) {
    return c.json({ error: { message: 'At least one of name or machine_name is required' } }, 400);
  }

  const executor = await updateExecutor(c.req.param('id'), userId, {
    name: body.name,
    machineName: body.machine_name,
  });

  if (!executor) {
    return c.json({ error: 'Executor not found' }, 404);
  }

  return c.json({
    executor: {
      id: executor.id,
      name: executor.name,
      machine_name: executor.machineName,
      type: executor.type,
      status: executor.status,
      repos: executor.repos,
      organization_id: executor.organizationId,
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

  const task = await startTask(taskId, executorId, userId);
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
    }, userId);

    if (!task) {
      return c.json(
        { error: 'Task not found or not assigned to this executor' },
        404,
      );
    }

    // Mark executor as available again
    await markExecutorTaskComplete(executorId, userId);

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

    const task = await failTask(taskId, executorId, body.error, userId);

    if (!task) {
      return c.json(
        { error: 'Task not found or not assigned to this executor' },
        404,
      );
    }

    // Mark executor as available again
    await markExecutorTaskComplete(executorId, userId);

    return c.json({
      task_id: task.id,
      status: task.status,
      completed_at: task.completedAt,
      error: task.error,
    });
  },
);

// ============================================================================
// POST /api/v1/executors/:id/tasks/:taskId/heartbeat — Task activity heartbeat
// ============================================================================

executors.post('/:id/tasks/:taskId/heartbeat', async (c) => {
  const userId = getUserId(c);
  const executorId = c.req.param('id');
  const taskId = c.req.param('taskId');

  const executor = await getExecutor(executorId, userId);
  if (!executor) {
    return c.json({ error: 'Executor not found' }, 404);
  }

  const task = await taskHeartbeat(taskId, executorId, userId);
  if (!task) {
    return c.json({ error: 'Task not found or not assigned to this executor' }, 404);
  }

  return c.json({
    task_id: task.id,
    status: task.status,
    updated_at: task.updatedAt,
  });
});

// ============================================================================
// POST /api/v1/executors/:id/offline — Mark executor offline (session-end)
// ============================================================================

executors.post('/:id/offline', async (c) => {
  const userId = getUserId(c);
  const executor = await updateExecutorStatus(c.req.param('id'), userId, 'offline');

  if (!executor) {
    return c.json({ error: 'Executor not found' }, 404);
  }

  return c.json({ executor_id: executor.id, status: executor.status });
});

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
