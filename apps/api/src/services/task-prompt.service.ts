import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db';
import {
  taskPrompts,
  agentTasks,
  type TaskPrompt,
  type TaskPromptOptions,
} from '../db/schema';

// ==================== Create Prompt ====================

export async function createTaskPrompt(params: {
  taskId: string;
  promptType?: 'question' | 'approval' | 'choice' | 'info';
  promptText: string;
  options?: TaskPromptOptions[] | string[];
  context?: Record<string, unknown>;
  expiresInMinutes?: number;
}): Promise<TaskPrompt> {
  const expiresAt = params.expiresInMinutes
    ? new Date(Date.now() + params.expiresInMinutes * 60 * 1000)
    : undefined;

  const [prompt] = await db
    .insert(taskPrompts)
    .values({
      taskId: params.taskId,
      promptType: params.promptType || 'question',
      promptText: params.promptText,
      options: params.options,
      context: params.context,
      expiresAt,
    })
    .returning();

  // Set the parent task to waiting_for_input
  await db
    .update(agentTasks)
    .set({
      status: 'waiting_for_input',
      updatedAt: new Date(),
    })
    .where(eq(agentTasks.id, params.taskId));

  return prompt;
}

// ==================== Respond to Prompt ====================

export async function respondToPrompt(
  promptId: string,
  response: string,
): Promise<TaskPrompt | null> {
  const [updated] = await db
    .update(taskPrompts)
    .set({
      response,
      respondedAt: new Date(),
    })
    .where(
      and(
        eq(taskPrompts.id, promptId),
        isNull(taskPrompts.response), // Prevent double-response
      ),
    )
    .returning();

  if (!updated) return null;

  // Check if there are any remaining unanswered prompts for this task
  const pending = await db.query.taskPrompts.findFirst({
    where: and(
      eq(taskPrompts.taskId, updated.taskId),
      isNull(taskPrompts.response),
    ),
  });

  // If all prompts are answered, set task back to running
  if (!pending) {
    await db
      .update(agentTasks)
      .set({
        status: 'running',
        updatedAt: new Date(),
      })
      .where(eq(agentTasks.id, updated.taskId));
  }

  return updated;
}

// ==================== Query Prompts ====================

export async function getTaskPrompts(taskId: string): Promise<TaskPrompt[]> {
  return db.query.taskPrompts.findMany({
    where: eq(taskPrompts.taskId, taskId),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });
}

export async function getPendingPrompts(taskId: string): Promise<TaskPrompt[]> {
  return db.query.taskPrompts.findMany({
    where: and(
      eq(taskPrompts.taskId, taskId),
      isNull(taskPrompts.response),
    ),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });
}

export async function getPrompt(promptId: string): Promise<TaskPrompt | undefined> {
  return db.query.taskPrompts.findFirst({
    where: eq(taskPrompts.id, promptId),
  });
}

/**
 * Get the latest responded prompt for a task that the executor hasn't seen yet.
 * Used by executor polling to discover answers to their questions.
 */
export async function getRespondedPrompts(taskId: string): Promise<TaskPrompt[]> {
  return db.query.taskPrompts.findMany({
    where: and(
      eq(taskPrompts.taskId, taskId),
      // Has a response (not null)
    ),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });
}
