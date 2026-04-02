/**
 * MCP Tools: Executor Relay
 * Exposes executor/task management to AI agents via MCP,
 * enabling a planner (Claude.ai) ↔ executor (Claude Code) loop.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAnnotations } from './annotations';
import { listExecutors, getExecutor } from '../../services/executor.service';
import { db } from '../../db';
import { eq, and } from 'drizzle-orm';
import { agentExecutors } from '../../db/schema';
import {
  createAgentTask,
  listAgentTasks,
  getAgentTask,
  cancelAgentTask,
} from '../../services/agent-task.service';
import {
  getTaskPrompts,
  getPendingPrompts,
  respondToPrompt,
} from '../../services/task-prompt.service';
import {
  getTaskLogs,
  getRecentTaskLogs,
} from '../../services/task-log.service';
import {
  getTaskEvents,
  respondToTaskEvent,
  createRedirectEvent,
  getTaskEventSummary,
} from '../../services/task-events.service';
import {
  getRepositoryByOwnerAndSlug,
  canUserAccessRepo,
} from '../../services/repository.service';
import { enrichTaskPrompt } from '../../services/task-enrichment.service';
import { createTaskEvent } from '../../services/task-events.service';

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
          machine_name: e.machineName ?? null,
          display_name: e.machineName || e.name,
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
      executor_id: z.string().uuid().optional()
        .describe('Target a specific executor by ID. Task will only be claimed by this executor.'),
      executor_name: z.string().optional()
        .describe('Target a specific executor by name (e.g. "tastytrade-mcp", "NyxCore"). Resolved to executor_id on creation.'),
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
        let targetExecutorId: string | undefined;

        // Resolve target executor (direct ID or name lookup)
        if (params.executor_id) {
          const targetExec = await db.query.agentExecutors.findFirst({
            where: and(
              eq(agentExecutors.id, params.executor_id),
              eq(agentExecutors.userId, userId),
            ),
          });
          if (!targetExec) {
            return { content: [{ type: 'text', text: `Executor not found: ${params.executor_id}` }], isError: true };
          }
          targetExecutorId = targetExec.id;
          if (!repositoryId && targetExec.repositoryId) {
            repositoryId = targetExec.repositoryId;
          }
        } else if (params.executor_name) {
          const executors = await listExecutors(userId);
          const match = executors.find(
            (e) =>
              e.name === params.executor_name ||
              e.name === `cva:${params.executor_name}` ||
              e.machineName === params.executor_name ||
              (e.machineName || '').toLowerCase() === (params.executor_name || '').toLowerCase() ||
              (e.name || '').toLowerCase().includes((params.executor_name || '').toLowerCase())
          );
          if (!match) {
            const names = executors
              .filter((e) => e.status === 'online')
              .map((e) => e.machineName || e.name)
              .join(', ');
            return {
              content: [{
                type: 'text',
                text: `No executor found matching "${params.executor_name}". Online executors: ${names || '(none)'}`,
              }],
              isError: true,
            };
          }
          targetExecutorId = match.id;
          if (!repositoryId && match.repositoryId) {
            repositoryId = match.repositoryId;
          }
        }

        if (params.owner && params.repo) {
          const repoData = await resolveRepo(params.owner, params.repo, userId);
          if (!repoData) {
            return { content: [{ type: 'text', text: 'Repository not found or access denied' }], isError: true };
          }
          repositoryId = repoData.id;
        }

        // Enrich task description with manifold context + structured output markers
        let enrichedDescription = params.description ?? '';
        try {
          const enrichment = await enrichTaskPrompt({
            repositoryId,
            description: params.description,
            filePaths: params.file_paths,
            userId,
          });
          if (enrichment) {
            enrichedDescription = enrichedDescription
              ? `${enrichedDescription}\n\n${enrichment}`
              : enrichment;
          }
        } catch {
          // Non-fatal: dispatch without enrichment if it fails
        }

        const task = await createAgentTask({
          userId,
          title: params.title,
          description: enrichedDescription,
          taskType: params.task_type,
          priority: params.priority,
          input: params.input
            ? { ...params.input, context: enrichedDescription }
            : { description: enrichedDescription },
          repositoryId,
          branch: params.branch,
          filePaths: params.file_paths,
          timeoutMinutes: params.timeout_minutes,
          targetExecutorId,
        });

        // Emit initial lifecycle event
        createTaskEvent({
          taskId: task.id,
          eventType: 'progress',
          content: { text: 'Task dispatched, waiting for executor' },
        }).catch(() => {});

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              task_id: task.id,
              status: task.status,
              priority: task.priority,
              target_executor_id: task.targetExecutorId ?? null,
              timeout_at: task.timeoutAt?.toISOString() ?? null,
              message: targetExecutorId
                ? `Task created and targeted to executor ${targetExecutorId}. It will claim on next poll.`
                : 'Task created. An executor will claim it on next poll.',
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

        const elapsed = task.startedAt
          ? Math.round(((task.completedAt ?? new Date()).getTime() - task.startedAt.getTime()) / 1000)
          : null;

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
              elapsed_seconds: elapsed,
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

  // ── check_active_tasks ────────────────────────────────────────────
  server.tool(
    'check_active_tasks',
    'Check all active tasks and surface any that need user input. Call this proactively to see if Claude Code instances need your attention.',
    {},
    getAnnotations('check_active_tasks'),
    async () => {
      try {
        const tasks = await listAgentTasks({
          userId,
          status: ['assigned', 'running', 'waiting_for_input'],
          limit: 20,
        });

        if (tasks.length === 0) {
          return { content: [{ type: 'text', text: 'No active tasks.' }] };
        }

        const results = [];
        for (const t of tasks) {
          const elapsed = t.startedAt
            ? Math.round((Date.now() - t.startedAt.getTime()) / 1000)
            : null;
          const lastActivity = t.updatedAt
            ? Math.round((Date.now() - t.updatedAt.getTime()) / 1000)
            : null;
          const entry: Record<string, unknown> = {
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            executor_id: t.executorId,
            started_at: t.startedAt?.toISOString() ?? null,
            elapsed_seconds: elapsed,
            last_activity_seconds_ago: lastActivity,
            possibly_stuck: lastActivity !== null && lastActivity > 300,
          };

          if (t.status === 'waiting_for_input') {
            const pending = await getPendingPrompts(t.id);
            entry.pending_prompts = pending.map((p) => ({
              prompt_id: p.id,
              type: p.promptType,
              text: p.promptText,
              options: p.options,
              context: p.context,
              created_at: p.createdAt.toISOString(),
            }));
          }

          // Include recent logs for at-a-glance progress
          const recentLogs = await getRecentTaskLogs(t.id, 3);
          if (recentLogs.length > 0) {
            entry.recent_logs = recentLogs.map((l) => ({
              log_type: l.logType,
              message: l.message,
              progress_pct: l.progressPct,
              created_at: l.createdAt.toISOString(),
            }));
          }

          results.push(entry);
        }

        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── get_task_prompts ──────────────────────────────────────────────
  server.tool(
    'get_task_prompts',
    'Get all prompts (questions/approvals) for a specific task. Shows what the executor has asked and any responses given.',
    {
      task_id: z.string().uuid().describe('Task ID'),
    },
    getAnnotations('get_task_prompts'),
    async ({ task_id }) => {
      try {
        const task = await getAgentTask(task_id, userId);
        if (!task) {
          return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
        }

        const prompts = await getTaskPrompts(task_id);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              task_id: task.id,
              task_title: task.title,
              task_status: task.status,
              prompts: prompts.map((p) => ({
                id: p.id,
                type: p.promptType,
                text: p.promptText,
                options: p.options,
                context: p.context,
                response: p.response,
                responded_at: p.respondedAt?.toISOString() ?? null,
                created_at: p.createdAt.toISOString(),
              })),
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── respond_to_prompt ─────────────────────────────────────────────
  server.tool(
    'respond_to_prompt',
    'Respond to a prompt from a Claude Code executor. The executor is waiting for your answer to continue working.',
    {
      prompt_id: z.string().uuid().describe('Prompt ID to respond to'),
      response: z.string().describe('Your response to the prompt'),
    },
    getAnnotations('respond_to_prompt'),
    async ({ prompt_id, response }) => {
      try {
        // Verify the prompt belongs to a task owned by this user
        const { getPrompt } = await import('../../services/task-prompt.service');
        const prompt = await getPrompt(prompt_id);
        if (!prompt) {
          return { content: [{ type: 'text', text: 'Prompt not found or already answered' }], isError: true };
        }
        const task = await getAgentTask(prompt.taskId, userId);
        if (!task) {
          return { content: [{ type: 'text', text: 'Prompt not found or already answered' }], isError: true };
        }

        const updated = await respondToPrompt(prompt_id, response);
        if (!updated) {
          return { content: [{ type: 'text', text: 'Prompt not found or already answered' }], isError: true };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              prompt_id: updated.id,
              task_id: updated.taskId,
              response: updated.response,
              responded_at: updated.respondedAt?.toISOString(),
              message: 'Response sent. The executor will continue on its next poll cycle.',
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── get_task_logs ─────────────────────────────────────────────────
  server.tool(
    'get_task_logs',
    'Get progress logs for a task. Shows lifecycle events, heartbeats, git activity, and errors reported by the executor.',
    {
      task_id: z.string().uuid().describe('Task ID'),
      limit: z.number().optional().describe('Max log entries to return (default: 50)'),
    },
    getAnnotations('get_task_logs'),
    async ({ task_id, limit }) => {
      try {
        const task = await getAgentTask(task_id, userId);
        if (!task) {
          return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
        }

        const logs = await getTaskLogs(task_id, limit ?? 50);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              task_id: task.id,
              task_title: task.title,
              task_status: task.status,
              log_count: logs.length,
              logs: logs.map((l) => ({
                id: l.id,
                log_type: l.logType,
                message: l.message,
                details: l.details,
                progress_pct: l.progressPct,
                created_at: l.createdAt.toISOString(),
              })),
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── cv_task_stream ──────────────────────────────────────────────────
  server.tool(
    'cv_task_stream',
    'Subscribe to a task\'s event stream. Returns the latest structured events (thinking, decisions, questions, progress) and any pending questions.',
    {
      task_id: z.string().uuid().describe('Task ID'),
      after_id: z.string().uuid().optional().describe('Only events after this event ID'),
      limit: z.number().optional().describe('Max events to return (default: 20)'),
    },
    getAnnotations('cv_task_stream'),
    async ({ task_id, after_id, limit }) => {
      try {
        const task = await getAgentTask(task_id, userId);
        if (!task) {
          return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
        }

        const events = await getTaskEvents({
          taskId: task_id,
          afterId: after_id,
          limit: limit ?? 20,
        });

        const pendingCount = events.filter(
          (e) => e.needsResponse && !e.respondedAt
        ).length;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              events: events.map((e) => ({
                id: e.id,
                event_type: e.eventType,
                content: e.content,
                needs_response: e.needsResponse,
                responded_at: e.respondedAt?.toISOString() ?? null,
                created_at: e.createdAt.toISOString(),
              })),
              pending_questions: pendingCount,
              total_events: events.length,
              task_status: task.status,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── cv_task_respond ─────────────────────────────────────────────────
  server.tool(
    'cv_task_respond',
    'Answer a question or approval request from the executor. The executor is waiting for your response to continue working.',
    {
      event_id: z.string().uuid().describe('The event ID to respond to'),
      response: z.string().describe('Your response to the question'),
    },
    getAnnotations('cv_task_respond'),
    async ({ event_id, response }) => {
      try {
        const updated = await respondToTaskEvent({
          eventId: event_id,
          response,
        });
        if (!updated) {
          return { content: [{ type: 'text', text: 'Event not found or already responded' }], isError: true };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              event_id: updated.id,
              responded_at: updated.respondedAt?.toISOString(),
              status: 'responded',
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── cv_task_redirect ────────────────────────────────────────────────
  server.tool(
    'cv_task_redirect',
    'Inject a new instruction into a running task. The executor will see this as a redirect event and adjust its approach.',
    {
      task_id: z.string().uuid().describe('Task ID'),
      instruction: z.string().describe('New instruction for the executor'),
    },
    getAnnotations('cv_task_redirect'),
    async ({ task_id, instruction }) => {
      try {
        const task = await getAgentTask(task_id, userId);
        if (!task) {
          return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
        }

        const event = await createRedirectEvent({
          taskId: task_id,
          instruction,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              event_id: event.id,
              created_at: event.createdAt.toISOString(),
              status: 'redirect_created',
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── cv_task_summary ─────────────────────────────────────────────────
  server.tool(
    'cv_task_summary',
    'Get a high-level summary of a task\'s progress without pulling all events. Shows latest thinking, decisions, progress, pending questions, and files changed.',
    {
      task_id: z.string().uuid().describe('Task ID'),
    },
    getAnnotations('cv_task_summary'),
    async ({ task_id }) => {
      try {
        const task = await getAgentTask(task_id, userId);
        if (!task) {
          return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
        }

        const summary = await getTaskEventSummary(task_id);

        const elapsed = task.startedAt
          ? Math.round(((task.completedAt ?? new Date()).getTime() - task.startedAt.getTime()) / 1000)
          : null;

        const extractText = (event?: { content: Record<string, unknown> | string | null }) => {
          if (!event) return null;
          if (typeof event.content === 'string') return event.content;
          return (event.content as Record<string, unknown>)?.text as string ?? null;
        };

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              task_id: task.id,
              status: task.status,
              total_events: summary.totalEvents,
              last_thinking: extractText(summary.lastThinking),
              last_decision: extractText(summary.lastDecision),
              last_progress: extractText(summary.lastProgress),
              pending_questions: summary.pendingQuestions.length,
              errors: summary.errors.length,
              files_changed: summary.fileChanges,
              elapsed_seconds: elapsed,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );
}
