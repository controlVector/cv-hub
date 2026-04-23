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
import { createTaskLog } from '../services/task-log.service';
import { createTaskPrompt, getPrompt } from '../services/task-prompt.service';
import { createTaskEvent } from '../services/task-events.service';
import { getUserOrganizations, getUserOrgRole } from '../services/organization.service';
import { getUserAccessibleRepositories, getRepositoryById } from '../services/repository.service';

import { processBanditFeedback, processTransitionLearning } from '../services/bandit-feedback.service';
import { recordDeployOutcome } from '../services/deploy-outcome.service';
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
  // Executor identity and safety metadata
  role: z.enum(['development', 'production', 'ci', 'staging']).optional(),
  dispatch_guard: z.enum(['open', 'confirm', 'locked']).optional(),
  integration: z.object({
    system: z.string(),
    description: z.string().optional(),
    service_port: z.number().optional(),
    safe_task_types: z.array(z.string()).optional(),
    unsafe_task_types: z.array(z.string()).optional(),
    self_referential: z.boolean().optional(),
  }).optional(),
  tags: z.array(z.string()).optional(),
  owner_project: z.string().max(100).optional(),
});

executors.post('/', zValidator('json', registerSchema), async (c) => {
  const userId = getUserId(c);
  const body = c.req.valid('json');
  const patOrgId = c.get('patOrgId');

  // Resolve repository first — used both to bind the executor and (when
  // the user belongs to multiple orgs) to disambiguate which org to attach
  // it to. Fixes #45: multi-org PATs were rejected even when the request
  // already named a repo whose owning org was unambiguous.
  let repositoryId = body.repository_id;
  let inferredOrgId: string | undefined;

  if (repositoryId) {
    const repo = await getRepositoryById(repositoryId);
    if (repo) {
      const { getUserOrgRole } = await import('../services/organization.service');
      const isOrgMember = repo.organizationId
        ? !!(await getUserOrgRole(repo.organizationId, userId))
        : false;
      const isPersonalOwner = repo.userId === userId;
      if (isOrgMember || isPersonalOwner) {
        inferredOrgId = repo.organizationId ?? undefined;
      } else {
        repositoryId = undefined;
      }
    } else {
      repositoryId = undefined;
    }
  } else if (body.repos?.length === 1) {
    try {
      const userRepos = await getUserAccessibleRepositories(userId, {
        search: body.repos[0],
        limit: 5,
      });
      const match = userRepos.find((r) => r.slug === body.repos![0]);
      if (match) {
        repositoryId = match.id;
        inferredOrgId = match.organizationId ?? undefined;
      }
    } catch {
      // Non-fatal — registration continues without repository_id
    }
  }

  // Resolve org server-side. Explicit organization_id beats the inferred one.
  const orgResult = await resolveOrganizationId(
    userId,
    body.organization_id ?? inferredOrgId,
    patOrgId,
  );
  if (orgResult.error) {
    return c.json({ error: orgResult.error }, 400);
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
    role: body.role,
    dispatchGuard: body.dispatch_guard,
    integration: body.integration,
    tags: body.tags,
    ownerProject: body.owner_project,
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
        role: executor.role,
        dispatch_guard: executor.dispatchGuard,
        integration: executor.integration,
        tags: executor.tags,
        owner_project: executor.ownerProject,
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

  // Emit lifecycle event: task claimed
  createTaskEvent({
    taskId: task.id,
    eventType: 'progress',
    content: { text: `Task claimed by executor ${executor.name || executorId}` },
  }).catch(() => {});

  // Enrich with owner/repo slugs if task has a repositoryId
  let owner: string | undefined;
  let repo: string | undefined;
  if (task.repositoryId) {
    try {
      const repository = await getRepositoryById(task.repositoryId);
      if (repository) {
        owner = repository.owner?.slug || repository.owner?.name;
        repo = repository.slug;
      }
    } catch {
      // Non-fatal — task still works without owner/repo
    }
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
      owner,
      repo,
      branch: task.branch,
      file_paths: task.filePaths,
      thread_id: task.threadId,
      parent_task_id: task.parentTaskId,
      target_executor_id: task.targetExecutorId,
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

  // Emit lifecycle event: task started
  createTaskEvent({
    taskId: task.id,
    eventType: 'progress',
    content: { text: 'Task started, launching Claude Code' },
  }).catch(() => {});

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
  // Legacy flat fields (cv-git < 0.7.18)
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
  // Structured payload (cv-git >= 0.7.18)
  commit: z.object({
    sha: z.string().nullable(),
    branch: z.string().nullable(),
    remote: z.string().nullable(),
    push_status: z.string(),
    messages: z.array(z.string()),
  }).optional(),
  files: z.object({
    added: z.array(z.string()),
    modified: z.array(z.string()),
    deleted: z.array(z.string()),
    total_changed: z.number(),
  }).optional(),
  stats: z.object({
    lines_added: z.number(),
    lines_deleted: z.number(),
    duration_seconds: z.number(),
  }).optional(),
  exit_code: z.number().optional(),
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
      // Legacy flat fields
      summary: body.summary,
      filesModified: body.files_modified,
      filesCreated: body.files_created,
      output: body.output,
      artifacts: body.artifacts,
      // Structured payload (cv-git >= 0.7.18)
      ...(body.commit ? { commit: body.commit } : {}),
      ...(body.files ? { files: body.files } : {}),
      ...(body.stats ? { stats: body.stats } : {}),
      ...(body.exit_code !== undefined ? { exit_code: body.exit_code } : {}),
    }, userId);

    if (!task) {
      return c.json(
        { error: 'Task not found or not assigned to this executor' },
        404,
      );
    }

    // Mark executor as available again
    await markExecutorTaskComplete(executorId, userId);

    // Fire-and-forget: bandit + transitions + deploy → manifold
    processBanditFeedback(taskId, 'completed').catch(() => {});
    processTransitionLearning(taskId).catch(() => {});
    recordDeployOutcome(taskId).catch(() => {});

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

    // Fire-and-forget: bandit learns from task outcome
    processBanditFeedback(taskId, 'failed').catch(() => {});

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

  // Optionally create a log entry if message is provided (backward compatible)
  let logId: string | undefined;
  try {
    const body = await c.req.json().catch(() => null);
    if (body?.message) {
      const log = await createTaskLog({
        taskId,
        logType: body.log_type || 'heartbeat',
        message: body.message,
        details: body.details,
      });
      logId = log.id;
    }
  } catch {
    // Empty body is fine — backward compatible
  }

  return c.json({
    task_id: task.id,
    status: task.status,
    updated_at: task.updatedAt,
    ...(logId ? { log_id: logId } : {}),
  });
});

// ============================================================================
// POST /api/v1/executors/:id/tasks/:taskId/log — Submit a progress log entry
// ============================================================================

const logSchema = z.object({
  log_type: z.enum(['lifecycle', 'heartbeat', 'progress', 'git', 'error', 'info']).optional(),
  message: z.string().min(1),
  details: z.record(z.unknown()).optional(),
  progress_pct: z.number().int().min(0).max(100).optional(),
});

executors.post(
  '/:id/tasks/:taskId/log',
  zValidator('json', logSchema),
  async (c) => {
    const userId = getUserId(c);
    const executorId = c.req.param('id');
    const taskId = c.req.param('taskId');
    const body = c.req.valid('json');

    const executor = await getExecutor(executorId, userId);
    if (!executor) {
      return c.json({ error: 'Executor not found' }, 404);
    }

    // Double-duty: log + liveness
    const task = await taskHeartbeat(taskId, executorId, userId);
    if (!task) {
      return c.json({ error: 'Task not found or not assigned to this executor' }, 404);
    }

    const log = await createTaskLog({
      taskId,
      logType: body.log_type,
      message: body.message,
      details: body.details,
      progressPct: body.progress_pct,
    });

    return c.json({
      log_id: log.id,
      task_id: taskId,
      created_at: log.createdAt,
    }, 201);
  },
);

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
// POST /api/v1/executors/:id/tasks/:taskId/prompt — Create a permission prompt
// ============================================================================

const promptSchema = z.object({
  type: z.enum(['question', 'approval', 'choice', 'info']).optional(),
  text: z.string().min(1),
  options: z.array(z.string()).optional(),
  context: z.record(z.unknown()).optional(),
});

executors.post(
  '/:id/tasks/:taskId/prompt',
  zValidator('json', promptSchema),
  async (c) => {
    const userId = getUserId(c);
    const executorId = c.req.param('id');
    const taskId = c.req.param('taskId');
    const body = c.req.valid('json');

    const executor = await getExecutor(executorId, userId);
    if (!executor) {
      return c.json({ error: 'Executor not found' }, 404);
    }

    const prompt = await createTaskPrompt({
      taskId,
      promptType: body.type || 'approval',
      promptText: body.text,
      options: body.options,
      context: body.context,
      expiresInMinutes: 5,
    });

    return c.json({
      prompt_id: prompt.id,
      task_id: taskId,
      created_at: prompt.createdAt,
    }, 201);
  },
);

// ============================================================================
// GET /api/v1/executors/:id/tasks/:taskId/prompts/:promptId — Poll for response
// ============================================================================

executors.get('/:id/tasks/:taskId/prompts/:promptId', async (c) => {
  const userId = getUserId(c);
  const executorId = c.req.param('id');
  const promptId = c.req.param('promptId');

  const executor = await getExecutor(executorId, userId);
  if (!executor) {
    return c.json({ error: 'Executor not found' }, 404);
  }

  const prompt = await getPrompt(promptId);
  if (!prompt) {
    return c.json({ error: 'Prompt not found' }, 404);
  }

  return c.json({
    prompt_id: prompt.id,
    task_id: prompt.taskId,
    prompt_type: prompt.promptType,
    prompt_text: prompt.promptText,
    options: prompt.options,
    response: prompt.response ?? null,
    responded_at: prompt.respondedAt ?? null,
    created_at: prompt.createdAt,
    expires_at: prompt.expiresAt,
  });
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
