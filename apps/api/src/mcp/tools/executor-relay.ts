/**
 * MCP Tools: Executor Relay
 * Exposes executor/task management to AI agents via MCP,
 * enabling a planner (Claude.ai) ↔ executor (Claude Code) loop.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAnnotations } from './annotations';
import { listExecutors } from '../../services/executor.service';
import {
  createAgentTask,
  listAgentTasks,
  getAgentTask,
  cancelAgentTask,
} from '../../services/agent-task.service';
import {
  getRepositoryByOwnerAndSlug,
  canUserAccessRepo,
} from '../../services/repository.service';

async function resolveRepo(owner: string, repoSlug: string, userId: string) {
  const repo = await getRepositoryByOwnerAndSlug(owner, repoSlug);
  if (!repo || !(await canUserAccessRepo(repo.id, userId))) {
    return null;
  }
  return repo;
}

export function registerExecutorRelayTools(
  server: McpServer,
  userId: string,
  _scopes: string[],
) {
  // ── list_executors ──────────────────────────────────────────────────
  server.tool(
    'list_executors',
    'List active Claude Code / CV-Git executor sessions registered by the current user',
    {},
    getAnnotations('list_executors'),
    async () => {
      try {
        const executors = await listExecutors(userId);
        const data = executors.map((e) => ({
          id: e.id,
          name: e.name,
          type: e.type,
          status: e.status,
          workspace_root: e.workspaceRoot,
          repository_id: e.repositoryId,
          capabilities: e.capabilities,
          last_heartbeat_at: e.lastHeartbeatAt?.toISOString() ?? null,
          last_task_at: e.lastTaskAt?.toISOString() ?? null,
          created_at: e.createdAt.toISOString(),
        }));
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error listing executors: ${err.message}` }], isError: true };
      }
    },
  );

  // ── create_task ─────────────────────────────────────────────────────
  server.tool(
    'create_task',
    'Dispatch a task to an executor (Claude Code session). The next time the executor polls, it will claim this task.',
    {
      title: z.string().describe('Short task title'),
      description: z.string().optional().describe('Detailed task description / instructions'),
      task_type: z.enum(['code_change', 'review', 'debug', 'research', 'deploy', 'test', 'custom']).optional()
        .describe('Task category (default: custom)'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional()
        .describe('Task priority (default: medium)'),
      owner: z.string().optional().describe('Repository owner (for repo-scoped tasks)'),
      repo: z.string().optional().describe('Repository slug (for repo-scoped tasks)'),
      branch: z.string().optional().describe('Git branch to work on'),
      file_paths: z.array(z.string()).optional().describe('Specific files to focus on'),
      input: z.object({
        description: z.string().optional(),
        context: z.string().optional(),
        files: z.array(z.string()).optional(),
        instructions: z.array(z.string()).optional(),
        constraints: z.array(z.string()).optional(),
      }).passthrough().optional().describe('Structured task input'),
      timeout_minutes: z.number().optional().describe('Task timeout in minutes (default: 30)'),
    },
    getAnnotations('create_task'),
    async (params) => {
      try {
        let repositoryId: string | undefined;

        if (params.owner && params.repo) {
          const repoData = await resolveRepo(params.owner, params.repo, userId);
          if (!repoData) {
            return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
          }
          repositoryId = repoData.id;
        }

        const task = await createAgentTask({
          userId,
          title: params.title,
          description: params.description,
          taskType: params.task_type,
          priority: params.priority,
          input: params.input,
          repositoryId,
          branch: params.branch,
          filePaths: params.file_paths,
          timeoutMinutes: params.timeout_minutes,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              task_id: task.id,
              status: task.status,
              priority: task.priority,
              timeout_at: task.timeoutAt?.toISOString() ?? null,
              message: 'Task created. An executor will claim it on next poll.',
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error creating task: ${err.message}` }], isError: true };
      }
    },
  );

  // ── list_tasks ──────────────────────────────────────────────────────
  server.tool(
    'list_tasks',
    'List agent tasks with optional filters (status, type, repository)',
    {
      status: z.array(z.string()).optional()
        .describe('Filter by status(es): pending, assigned, running, completed, failed, cancelled'),
      task_type: z.string().optional().describe('Filter by task type'),
      owner: z.string().optional().describe('Repository owner (for repo-scoped filter)'),
      repo: z.string().optional().describe('Repository slug (for repo-scoped filter)'),
      limit: z.number().optional().describe('Max results (default: 20)'),
    },
    getAnnotations('list_tasks'),
    async (params) => {
      try {
        let repositoryId: string | undefined;

        if (params.owner && params.repo) {
          const repoData = await resolveRepo(params.owner, params.repo, userId);
          if (!repoData) {
            return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
          }
          repositoryId = repoData.id;
        }

        const tasks = await listAgentTasks({
          userId,
          status: params.status,
          taskType: params.task_type,
          repositoryId,
          limit: params.limit,
        });

        const data = tasks.map((t) => ({
          id: t.id,
          title: t.title,
          task_type: t.taskType,
          status: t.status,
          priority: t.priority,
          executor_id: t.executorId,
          repository_id: t.repositoryId,
          branch: t.branch,
          error: t.error,
          created_at: t.createdAt.toISOString(),
          started_at: t.startedAt?.toISOString() ?? null,
          completed_at: t.completedAt?.toISOString() ?? null,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error listing tasks: ${err.message}` }], isError: true };
      }
    },
  );

  // ── get_task_result ─────────────────────────────────────────────────
  server.tool(
    'get_task_result',
    'Get full details and result of a specific task',
    {
      task_id: z.string().uuid().describe('Task ID'),
    },
    getAnnotations('get_task_result'),
    async ({ task_id }) => {
      try {
        const task = await getAgentTask(task_id, userId);
        if (!task) {
          return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: task.id,
              title: task.title,
              description: task.description,
              task_type: task.taskType,
              status: task.status,
              priority: task.priority,
              executor_id: task.executorId,
              input: task.input,
              result: task.result,
              error: task.error,
              repository_id: task.repositoryId,
              branch: task.branch,
              file_paths: task.filePaths,
              parent_task_id: task.parentTaskId,
              created_at: task.createdAt.toISOString(),
              started_at: task.startedAt?.toISOString() ?? null,
              completed_at: task.completedAt?.toISOString() ?? null,
              timeout_at: task.timeoutAt?.toISOString() ?? null,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error getting task: ${err.message}` }], isError: true };
      }
    },
  );

  // ── cancel_task ─────────────────────────────────────────────────────
  server.tool(
    'cancel_task',
    'Cancel a pending or in-progress task',
    {
      task_id: z.string().uuid().describe('Task ID to cancel'),
    },
    getAnnotations('cancel_task'),
    async ({ task_id }) => {
      try {
        const task = await cancelAgentTask(task_id, userId);
        if (!task) {
          return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              task_id: task.id,
              status: task.status,
              message: task.status === 'cancelled' ? 'Task cancelled' : `Task already in terminal state: ${task.status}`,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error cancelling task: ${err.message}` }], isError: true };
      }
    },
  );
}
