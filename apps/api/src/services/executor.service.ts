import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db';
import {
  agentExecutors,
  type AgentExecutor,
  type ExecutorCapabilities,
} from '../db/schema';
import { generateSecureToken } from '../utils/crypto';

// ==================== Registration ====================

export async function registerExecutor(params: {
  userId: string;
  name: string;
  type?: 'claude_code' | 'cv_git' | 'custom';
  capabilities?: ExecutorCapabilities;
  workspaceRoot?: string;
  repositoryId?: string;
}): Promise<{ executor: AgentExecutor; registrationToken: string }> {
  const registrationToken = generateSecureToken(32);

  const [executor] = await db
    .insert(agentExecutors)
    .values({
      userId: params.userId,
      name: params.name,
      type: params.type || 'claude_code',
      status: 'online',
      capabilities: params.capabilities,
      workspaceRoot: params.workspaceRoot,
      repositoryId: params.repositoryId,
      registrationToken,
      lastHeartbeatAt: new Date(),
    })
    .returning();

  return { executor, registrationToken };
}

// ==================== Lookup ====================

export async function getExecutor(
  executorId: string,
  userId: string,
): Promise<AgentExecutor | undefined> {
  return db.query.agentExecutors.findFirst({
    where: and(
      eq(agentExecutors.id, executorId),
      eq(agentExecutors.userId, userId),
    ),
  });
}

export async function getExecutorByToken(
  registrationToken: string,
): Promise<AgentExecutor | undefined> {
  return db.query.agentExecutors.findFirst({
    where: eq(agentExecutors.registrationToken, registrationToken),
  });
}

export async function listExecutors(
  userId: string,
): Promise<AgentExecutor[]> {
  return db.query.agentExecutors.findMany({
    where: eq(agentExecutors.userId, userId),
    orderBy: [desc(agentExecutors.lastHeartbeatAt)],
  });
}

// ==================== Heartbeat & Status ====================

export async function heartbeat(
  executorId: string,
  userId: string,
): Promise<AgentExecutor | null> {
  const [updated] = await db
    .update(agentExecutors)
    .set({
      lastHeartbeatAt: new Date(),
      status: 'online',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentExecutors.id, executorId),
        eq(agentExecutors.userId, userId),
      ),
    )
    .returning();

  return updated || null;
}

export async function updateExecutorStatus(
  executorId: string,
  userId: string,
  status: 'online' | 'offline' | 'busy' | 'error',
): Promise<AgentExecutor | null> {
  const [updated] = await db
    .update(agentExecutors)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentExecutors.id, executorId),
        eq(agentExecutors.userId, userId),
      ),
    )
    .returning();

  return updated || null;
}

export async function markExecutorTaskComplete(
  executorId: string,
): Promise<void> {
  await db
    .update(agentExecutors)
    .set({
      status: 'online',
      lastTaskAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentExecutors.id, executorId));
}

// ==================== Unregister ====================

export async function unregisterExecutor(
  executorId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(agentExecutors)
    .where(
      and(
        eq(agentExecutors.id, executorId),
        eq(agentExecutors.userId, userId),
      ),
    )
    .returning({ id: agentExecutors.id });

  return result.length > 0;
}
