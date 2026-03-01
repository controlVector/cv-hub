/**
 * Session Binding Service
 *
 * Links MCP sessions (Claude.ai conversations) to specific executors (Claude Code instances).
 * Enables a user to say "connect me to my Z840" and route all subsequent tasks to that machine.
 */

import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '../db';
import {
  sessionBindings,
  agentExecutors,
  type SessionBinding,
  type AgentExecutor,
} from '../db/schema';

// ==================== Bind / Unbind ====================

export async function bindSession(params: {
  mcpSessionId: string;
  executorId: string;
  userId: string;
  organizationId: string;
}): Promise<SessionBinding> {
  // Check if there's already an active binding for this session
  const existing = await db.query.sessionBindings.findFirst({
    where: and(
      eq(sessionBindings.mcpSessionId, params.mcpSessionId),
      isNull(sessionBindings.unboundAt),
    ),
  });

  if (existing) {
    throw new Error(
      'This conversation is already connected to a machine. Use cv_disconnect first.',
    );
  }

  // Verify executor exists and is online
  const executor = await db.query.agentExecutors.findFirst({
    where: eq(agentExecutors.id, params.executorId),
  });

  if (!executor) {
    throw new Error('Executor not found.');
  }

  if (executor.userId !== params.userId) {
    throw new Error('Executor not found.');
  }

  if (executor.status !== 'online') {
    throw new Error(
      `Machine "${executor.machineName || executor.name}" is ${executor.status}. Only online machines can be connected.`,
    );
  }

  const [binding] = await db
    .insert(sessionBindings)
    .values({
      mcpSessionId: params.mcpSessionId,
      executorId: params.executorId,
      userId: params.userId,
      organizationId: params.organizationId,
    })
    .returning();

  return binding;
}

export async function unbindSession(
  mcpSessionId: string,
  userId: string,
): Promise<SessionBinding | null> {
  const [updated] = await db
    .update(sessionBindings)
    .set({ unboundAt: new Date() })
    .where(
      and(
        eq(sessionBindings.mcpSessionId, mcpSessionId),
        eq(sessionBindings.userId, userId),
        isNull(sessionBindings.unboundAt),
      ),
    )
    .returning();

  return updated || null;
}

// ==================== Query ====================

export async function getActiveBinding(
  mcpSessionId: string,
): Promise<(SessionBinding & { executor: AgentExecutor }) | null> {
  const binding = await db.query.sessionBindings.findFirst({
    where: and(
      eq(sessionBindings.mcpSessionId, mcpSessionId),
      isNull(sessionBindings.unboundAt),
    ),
    with: {
      executor: true,
    },
  });

  return (binding as (SessionBinding & { executor: AgentExecutor })) ?? null;
}

export async function getBindingHistory(
  mcpSessionId: string,
): Promise<SessionBinding[]> {
  return db.query.sessionBindings.findMany({
    where: eq(sessionBindings.mcpSessionId, mcpSessionId),
    orderBy: [desc(sessionBindings.boundAt)],
  });
}

// ==================== Dispatch Resolution ====================

/**
 * Resolve which executor to dispatch a task to.
 *
 * 1. If session has an active binding → use bound executor (verify online)
 * 2. If bound executor is offline → throw with suggestion
 * 3. If no binding → fall back to any available online executor for the user
 */
export async function resolveExecutorForDispatch(
  mcpSessionId: string,
  userId: string,
): Promise<{ executor: AgentExecutor; viaBind: boolean }> {
  const binding = await getActiveBinding(mcpSessionId);

  if (binding) {
    if (binding.executor.status === 'online') {
      return { executor: binding.executor, viaBind: true };
    }

    throw new Error(
      `Your connected machine "${binding.executor.machineName || binding.executor.name}" appears to be offline. ` +
        'Use cv_list_executors to see what\'s available, or cv_disconnect to unlink and dispatch to any available machine.',
    );
  }

  // No binding — fall back to any online executor
  const executor = await db.query.agentExecutors.findFirst({
    where: and(
      eq(agentExecutors.userId, userId),
      eq(agentExecutors.status, 'online'),
    ),
    orderBy: [desc(agentExecutors.lastHeartbeatAt)],
  });

  if (!executor) {
    throw new Error(
      'No online machines found. Start a Claude Code session with CV-Hub hooks to register a machine.',
    );
  }

  return { executor, viaBind: false };
}
