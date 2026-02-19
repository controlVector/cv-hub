import { registerTool } from '../handler';
import {
  createAgentTask,
  getAgentTask,
  listAgentTasks,
  cancelAgentTask,
} from '../../services/agent-task.service';
import type { MCPTool, MCPToolResult, MCPSessionContext } from '../types';

// ============================================================================
// create_task
// ============================================================================

const createTaskTool: MCPTool = {
  name: 'create_task',
  description:
    'Create a new task for a Claude Code executor to work on. The task will be queued and picked up by an available executor.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Short title for the task',
      },
      description: {
        type: 'string',
        description:
          'Detailed description of what needs to be done, including context and requirements',
      },
      task_type: {
        type: 'string',
        description: 'Type of task',
        enum: [
          'code_change',
          'review',
          'debug',
          'research',
          'deploy',
          'test',
          'custom',
        ],
      },
      priority: {
        type: 'string',
        description: 'Task priority',
        enum: ['low', 'medium', 'high', 'critical'],
      },
      repository_id: {
        type: 'string',
        description: 'Repository UUID to work in (optional)',
      },
      branch: {
        type: 'string',
        description: 'Git branch to work on (optional)',
      },
      file_paths: {
        type: 'array',
        description: 'Specific files relevant to this task (optional)',
        items: { type: 'string' },
      },
      thread_id: {
        type: 'string',
        description:
          'Workflow thread ID to associate this task with (optional, for continuity)',
      },
      context: {
        type: 'string',
        description: 'Additional context or instructions for the executor',
      },
      timeout_minutes: {
        type: 'number',
        description: 'Task timeout in minutes (default: 30)',
      },
    },
    required: ['title'],
  },
};

async function handleCreateTask(
  args: Record<string, unknown>,
  ctx: MCPSessionContext,
): Promise<MCPToolResult> {
  const task = await createAgentTask({
    userId: ctx.userId,
    title: args.title as string,
    description: args.description as string | undefined,
    taskType: (args.task_type as any) || 'custom',
    priority: (args.priority as any) || 'medium',
    repositoryId: args.repository_id as string | undefined,
    branch: args.branch as string | undefined,
    filePaths: args.file_paths as string[] | undefined,
    threadId: args.thread_id as string | undefined,
    mcpSessionId: ctx.sessionId,
    timeoutMinutes: args.timeout_minutes as number | undefined,
    input: {
      description: args.description as string | undefined,
      context: args.context as string | undefined,
      files: args.file_paths as string[] | undefined,
    },
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            task_id: task.id,
            status: task.status,
            title: task.title,
            priority: task.priority,
            created_at: task.createdAt,
            timeout_at: task.timeoutAt,
            message: 'Task created and queued. An executor will pick it up shortly.',
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ============================================================================
// list_tasks
// ============================================================================

const listTasksTool: MCPTool = {
  name: 'list_tasks',
  description:
    'List agent tasks. Filter by status, type, or thread. Returns most recent tasks first.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'array',
        description: 'Filter by status(es)',
        items: {
          type: 'string',
          enum: [
            'pending',
            'queued',
            'assigned',
            'running',
            'completed',
            'failed',
            'cancelled',
          ],
        },
      },
      task_type: {
        type: 'string',
        description: 'Filter by task type',
        enum: [
          'code_change',
          'review',
          'debug',
          'research',
          'deploy',
          'test',
          'custom',
        ],
      },
      thread_id: {
        type: 'string',
        description: 'Filter by workflow thread ID',
      },
      repository_id: {
        type: 'string',
        description: 'Filter by repository ID',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 20)',
      },
    },
  },
};

async function handleListTasks(
  args: Record<string, unknown>,
  ctx: MCPSessionContext,
): Promise<MCPToolResult> {
  const tasks = await listAgentTasks({
    userId: ctx.userId,
    status: args.status as string[] | undefined,
    taskType: args.task_type as string | undefined,
    repositoryId: args.repository_id as string | undefined,
    threadId: args.thread_id as string | undefined,
    limit: (args.limit as number) || 20,
  });

  const summary = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    task_type: t.taskType,
    priority: t.priority,
    executor_id: t.executorId,
    thread_id: t.threadId,
    created_at: t.createdAt,
    started_at: t.startedAt,
    completed_at: t.completedAt,
    has_result: !!t.result,
    has_error: !!t.error,
  }));

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ tasks: summary, total: tasks.length }, null, 2),
      },
    ],
  };
}

// ============================================================================
// get_task_result
// ============================================================================

const getTaskResultTool: MCPTool = {
  name: 'get_task_result',
  description:
    'Get the full details and result of a specific task. Includes input, output, error info, and timing.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'The task UUID to retrieve',
      },
    },
    required: ['task_id'],
  },
};

async function handleGetTaskResult(
  args: Record<string, unknown>,
  ctx: MCPSessionContext,
): Promise<MCPToolResult> {
  const task = await getAgentTask(args.task_id as string, ctx.userId);

  if (!task) {
    return {
      content: [{ type: 'text', text: 'Task not found.' }],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            task_type: task.taskType,
            priority: task.priority,
            input: task.input,
            result: task.result,
            error: task.error,
            executor_id: task.executorId,
            thread_id: task.threadId,
            repository_id: task.repositoryId,
            branch: task.branch,
            file_paths: task.filePaths,
            created_at: task.createdAt,
            started_at: task.startedAt,
            completed_at: task.completedAt,
            timeout_at: task.timeoutAt,
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ============================================================================
// cancel_task
// ============================================================================

const cancelTaskTool: MCPTool = {
  name: 'cancel_task',
  description: 'Cancel a pending or running task.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'The task UUID to cancel',
      },
    },
    required: ['task_id'],
  },
};

async function handleCancelTask(
  args: Record<string, unknown>,
  ctx: MCPSessionContext,
): Promise<MCPToolResult> {
  const task = await cancelAgentTask(args.task_id as string, ctx.userId);

  if (!task) {
    return {
      content: [{ type: 'text', text: 'Task not found.' }],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            id: task.id,
            status: task.status,
            message:
              task.status === 'cancelled'
                ? 'Task cancelled successfully.'
                : `Task already in terminal state: ${task.status}`,
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ============================================================================
// Register all task relay tools
// ============================================================================

export function registerTaskRelayTools(): void {
  registerTool(createTaskTool, handleCreateTask);
  registerTool(listTasksTool, handleListTasks);
  registerTool(getTaskResultTool, handleGetTaskResult);
  registerTool(cancelTaskTool, handleCancelTask);
}
