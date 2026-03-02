import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth';
import {
  createTaskPrompt,
  respondToPrompt,
  getTaskPrompts,
  getPendingPrompts,
  getPrompt,
} from '../services/task-prompt.service';
import { getAgentTask } from '../services/agent-task.service';

import type { AppEnv } from '../app';

const taskPromptRoutes = new Hono<AppEnv>();

taskPromptRoutes.use('*', requireAuth);

function getUserId(c: any): string {
  const userId = c.get('userId');
  if (!userId) throw new Error('Not authenticated');
  return userId;
}

// ============================================================================
// POST /api/v1/tasks/:taskId/prompts — Create a prompt (executor → user)
// ============================================================================

const createPromptSchema = z.object({
  prompt_type: z.enum(['question', 'approval', 'choice', 'info']).optional(),
  prompt_text: z.string().min(1).max(2000),
  options: z
    .array(
      z.union([
        z.string(),
        z.object({
          label: z.string(),
          description: z.string().optional(),
        }),
      ])
    )
    .optional(),
  context: z.record(z.unknown()).optional(),
  expires_in_minutes: z.number().min(1).max(1440).optional(),
});

taskPromptRoutes.post(
  '/:taskId/prompts',
  zValidator('json', createPromptSchema),
  async (c) => {
    const userId = getUserId(c);
    const taskId = c.req.param('taskId');
    const body = c.req.valid('json');

    // Verify task exists and belongs to user
    const task = await getAgentTask(taskId, userId);
    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }

    // Only allow prompts on active tasks
    if (!['assigned', 'running'].includes(task.status)) {
      return c.json(
        { error: `Cannot create prompt for task in status: ${task.status}` },
        400,
      );
    }

    const prompt = await createTaskPrompt({
      taskId,
      promptType: body.prompt_type,
      promptText: body.prompt_text,
      options: body.options,
      context: body.context,
      expiresInMinutes: body.expires_in_minutes,
    });

    return c.json(
      {
        id: prompt.id,
        task_id: prompt.taskId,
        prompt_type: prompt.promptType,
        prompt_text: prompt.promptText,
        options: prompt.options,
        context: prompt.context,
        created_at: prompt.createdAt,
        expires_at: prompt.expiresAt,
      },
      201,
    );
  },
);

// ============================================================================
// GET /api/v1/tasks/:taskId/prompts — List all prompts for a task
// ============================================================================

taskPromptRoutes.get('/:taskId/prompts', async (c) => {
  const userId = getUserId(c);
  const taskId = c.req.param('taskId');

  const task = await getAgentTask(taskId, userId);
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const prompts = await getTaskPrompts(taskId);

  return c.json({
    prompts: prompts.map((p) => ({
      id: p.id,
      task_id: p.taskId,
      prompt_type: p.promptType,
      prompt_text: p.promptText,
      options: p.options,
      context: p.context,
      response: p.response,
      responded_at: p.respondedAt,
      created_at: p.createdAt,
      expires_at: p.expiresAt,
    })),
  });
});

// ============================================================================
// GET /api/v1/tasks/:taskId/prompts/pending — Get unanswered prompts
// ============================================================================

taskPromptRoutes.get('/:taskId/prompts/pending', async (c) => {
  const userId = getUserId(c);
  const taskId = c.req.param('taskId');

  const task = await getAgentTask(taskId, userId);
  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const prompts = await getPendingPrompts(taskId);

  return c.json({
    prompts: prompts.map((p) => ({
      id: p.id,
      task_id: p.taskId,
      prompt_type: p.promptType,
      prompt_text: p.promptText,
      options: p.options,
      context: p.context,
      created_at: p.createdAt,
      expires_at: p.expiresAt,
    })),
  });
});

// ============================================================================
// POST /api/v1/tasks/:taskId/prompts/:promptId/respond — Answer a prompt
// ============================================================================

const respondSchema = z.object({
  response: z.string().min(1).max(2000),
});

taskPromptRoutes.post(
  '/:taskId/prompts/:promptId/respond',
  zValidator('json', respondSchema),
  async (c) => {
    const userId = getUserId(c);
    const taskId = c.req.param('taskId');
    const promptId = c.req.param('promptId');
    const { response } = c.req.valid('json');

    // Verify task belongs to user
    const task = await getAgentTask(taskId, userId);
    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }

    // Verify prompt belongs to this task
    const prompt = await getPrompt(promptId);
    if (!prompt || prompt.taskId !== taskId) {
      return c.json({ error: 'Prompt not found' }, 404);
    }

    if (prompt.response !== null) {
      return c.json({ error: 'Prompt already answered' }, 409);
    }

    const updated = await respondToPrompt(promptId, response);
    if (!updated) {
      return c.json({ error: 'Failed to respond — prompt may have expired' }, 400);
    }

    return c.json({
      id: updated.id,
      task_id: updated.taskId,
      response: updated.response,
      responded_at: updated.respondedAt,
    });
  },
);

export { taskPromptRoutes };
